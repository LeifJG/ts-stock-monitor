// ============================================================
// daily-report.ts — 收盘日报生成器（服务端，唯一实现）
// ------------------------------------------------------------
// 取代 scripts/daily_portfolio_report.py（旧版只 print、不落盘、
// 港股汇率缺失、口径与页面不一致）。
//
// 数据源（全部服务端本地/内网，无浏览器依赖）：
//   - data/portfolio.json      持仓（经 usePortfolioSync 自动同步）
//   - /api/stocks 实时行情      fetchFullStockData 直调
//   - data/advice_cache.json   操作建议/网格/PE（portfolio_advice 缓存）
//   - cache/index_valuations.json 指数估值温度表
//
// 口径：与页面完全一致 —— 全部复用 portfolio-calc
//   （normalizePosition 归一化、港股 ×0.86、盈亏含分红回补）。
//
// 幂等规则：交易日（周一~五）北京时间 15:05 后生成当天报告；
//   当天已生成则直接复用；周末复用最近一份报告。
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { fetchFullStockData } from "@/lib/stock-api";
import { setHkdRate } from "@/lib/stockUtils";
import {
  normalizePositions,
  calcPositionMetrics,
  calcPortfolioSummary,
  type NormalizedPosition,
} from "@/lib/portfolio-calc";
import type { Position, StockData } from "@/lib/types";

const CACHE_DIR = path.join(process.cwd(), "cache");
const REPORT_FILE = path.join(CACHE_DIR, "latest_report.md");
const ADVICE_CACHE = path.join(process.cwd(), "data", "advice_cache.json");
const VALUATION_CACHE = path.join(CACHE_DIR, "index_valuations.json");

// ─── 时间工具（北京时间 UTC+8） ─────────────────────────────

function beijingNow(): Date {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
function beijingDateStr(): string {
  return beijingNow().toISOString().slice(0, 10);
}
function beijingMinutes(): number {
  const d = beijingNow();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function isTradingDayToday(): boolean {
  const day = beijingNow().getUTCDay();
  return day >= 1 && day <= 5;
}

/** 收盘线：15:05（留 5 分钟等收盘数据落定） */
const CLOSE_OFFSET_MIN = 15 * 60 + 5;

// ─── advice 缓存读取 ────────────────────────────────────────

interface AdviceItem {
  stockCode: string;
  stockName?: string;
  pe?: number | null;
  operations?: Array<{ action: string; reason: string; priority?: string }>;
  gridLevels?: Array<{ type: string; price: number; label?: string }>;
}

function loadAdviceMap(): Map<string, AdviceItem> {
  const m = new Map<string, AdviceItem>();
  try {
    const raw = JSON.parse(fs.readFileSync(ADVICE_CACHE, "utf-8"));
    // 结构: { timestamp, data: { success, advice: [...] } }
    const list = raw?.data?.advice;
    if (Array.isArray(list)) {
      list.forEach((a: AdviceItem) => m.set(a.stockCode, a));
    }
  } catch {
    // 缓存缺失/损坏 → 无建议板块，不影响日报主体
  }
  return m;
}

// ─── 市场温度表 ─────────────────────────────────────────────

interface IndexValuation {
  name: string;
  pe?: number;
  pct_5y?: number;
  desc?: string;
  etf?: string;
}

function loadValuations(): { indices: IndexValuation[]; asOf?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(VALUATION_CACHE, "utf-8"));
    // generated_at 为毫秒时间戳或 ISO 字符串
    let asOf: string | undefined;
    const g = raw?.generated_at;
    if (typeof g === "number") asOf = new Date(g + 8 * 3600 * 1000).toISOString().slice(0, 10);
    else if (typeof g === "string") asOf = g.slice(0, 10);
    return { indices: Array.isArray(raw?.indices) ? raw.indices : [], asOf };
  } catch {
    return { indices: [] };
  }
}

// ─── 格式化 ─────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null && Number.isFinite(v) ? v.toFixed(d) : "--";
const fmtPct = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";
const fmtMoney = (v: number): string => {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return abs >= 10000 ? `${sign}¥${(abs / 10000).toFixed(2)}万` : `${sign}¥${abs.toFixed(2)}`;
};

// ─── 幂等检查 ───────────────────────────────────────────────

/** 现有报告是否已经覆盖「本次需要」：交易日 15:05 后需要当日报告；其余时间复用最近一份 */
export function isReportFresh(): boolean {
  try {
    const stats = fs.statSync(REPORT_FILE);
    if (!stats.isFile()) return false;
    const mtime = new Date(stats.mtime.getTime() + 8 * 3600 * 1000); // → 北京时间
    const mtimeDate = mtime.toISOString().slice(0, 10);
    const mtimeMins = mtime.getUTCHours() * 60 + mtime.getUTCMinutes();

    if (mtimeDate !== beijingDateStr()) return false; // 不是今天的报告
    if (!isTradingDayToday()) return true;             // 周末：今天的报告即最新
    return mtimeMins >= CLOSE_OFFSET_MIN;              // 交易日：需在 15:05 后生成
  } catch {
    return false;
  }
}

// ─── 生成 ───────────────────────────────────────────────────

export async function generateDailyReport(force = false): Promise<{ content: string; generatedAt: string }> {
  if (!force && isReportFresh()) {
    return { content: fs.readFileSync(REPORT_FILE, "utf-8"), generatedAt: fs.statSync(REPORT_FILE).mtime.toISOString() };
  }

  // 0) 注入实时港币汇率（P1-5：缓存缺失时沿用默认 0.86）
  try {
    const fx = JSON.parse(fs.readFileSync(path.join(process.cwd(), "cache", "fx_rate.json"), "utf-8"));
    if (typeof fx?.rate === "number") setHkdRate(fx.rate);
  } catch {
    /* 沿用默认 */
  }

  // 1) 持仓（归一化 + 坏数据过滤，与页面同源同口径）
  const raw: Position[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "portfolio.json"), "utf-8")
  );
  const positions = normalizePositions(raw);
  if (positions.length === 0) {
    const empty = `📊 **收盘持仓报告** — ${beijingDateStr()}\n\n暂无持仓数据。\n`;
    writeReport(empty);
    return { content: empty, generatedAt: new Date().toISOString() };
  }

  // 2) 实时行情（含港股）
  const stocks: StockData[] = await fetchFullStockData(positions.map((p) => p.stockCode));
  const stockMap = new Map<string, StockData>();
  stocks.forEach((s) => stockMap.set(s.quote.code, s));

  // 3) 指标（portfolio-calc 唯一口径）+ 建议缓存
  const adviceMap = loadAdviceMap();
  const metrics = new Map<string, ReturnType<typeof calcPositionMetrics>>();
  for (const p of positions) metrics.set(p.id, calcPositionMetrics(p, stockMap.get(p.stockCode)));
  const summary = calcPortfolioSummary(positions, stockMap);

  // 显示名回退链：持仓名 → 行情名 → 建议缓存名 → 代码（portfolio.json 无名称字段）
  const displayName = (pos: NormalizedPosition): string =>
    pos.stockName !== pos.stockCode
      ? pos.stockName
      : stockMap.get(pos.stockCode)?.quote?.name ||
        adviceMap.get(pos.stockCode)?.stockName ||
        pos.stockCode;

  // ── 组装 Markdown ──
  const now = beijingNow();
  const lines: string[] = [];
  lines.push(`📊 **收盘持仓报告** — ${now.toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const pos of positions) {
    const m = metrics.get(pos.id)!;
    const sd = stockMap.get(pos.stockCode);
    const adv = adviceMap.get(pos.stockCode);
    const isHK = pos.stockCode.length === 5;
    const cur = isHK ? "HK$" : "¥";
    const pnlSymbol = m.totalProfit > 0 ? "📈" : m.totalProfit < 0 ? "📉" : "➖";

    lines.push(`### ${pnlSymbol} ${displayName(pos)} (${pos.stockCode})${isHK ? " ·港" : ""}`);
    lines.push("");
    lines.push("| 指标 | 数值 |");
    lines.push("|:---|:---:|");
    lines.push(`| 现价 | ${cur}${fmt(sd?.quote.currentPrice ?? pos.buyPrice)} |`);
    lines.push(`| 成本价 | ${cur}${fmt(pos.buyPrice)} |`);
    lines.push(`| 持仓 | ${pos.shares.toLocaleString()} 股 |`);
    lines.push(`| 盈亏 | ${fmtPct(m.totalProfitPct)}（${fmtMoney(m.totalProfit)}）|`);
    lines.push(`| 市值 | ${fmtMoney(m.marketValue)} |`);
    lines.push(`| 累计分红 | ${fmtMoney(m.totalDividends)} |`);
    const peVal = adv?.pe ?? sd?.fundamentals?.pe;
    // PE<=0（亏损股）无估值参考意义，避免「估值偏低可加仓」类误导
    lines.push(`| PE | ${peVal != null && peVal > 0 ? fmt(peVal, 2) : "亏损，不适用"} |`);
    lines.push(`| 现价股息率 | ${fmt(sd?.fundamentals?.dividendYield, 2)}% |`);
    if (m.costYield > 0) lines.push(`| 成本股息率 | **${fmt(m.costYield)}%** |`);
    lines.push("");

    const ops = adv?.operations ?? [];
    if (ops.length > 0) {
      lines.push("**📋 操作建议：**");
      for (const op of ops) {
        // 过滤亏损股上的「估值偏低」建议（PE 为负时的误判）
        if (op.action.includes("估值偏低") && peVal != null && peVal <= 0) continue;
        const p = op.priority ?? "info";
        const icon = p === "high" ? "🔴" : p === "medium" ? "🟡" : "🔵";
        lines.push(`- ${icon} **${op.action}**: ${op.reason}`);
      }
      lines.push("");
    }

    const grid = adv?.gridLevels ?? [];
    const buys = grid.filter((g) => g.type === "buy").slice(0, 3);
    const sells = grid.filter((g) => g.type === "sell").slice(0, 3);
    if (buys.length > 0) {
      lines.push(`📐 **网格买入**: ${buys.map((g) => `${cur}${fmt(g.price)}`).join(" / ")}`);
    }
    if (sells.length > 0) {
      lines.push(`📐 **网格卖出**: ${sells.map((g) => `${cur}${fmt(g.price)}`).join(" / ")}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // 组合汇总（CNY，含分红，与页面一致）
  lines.push("### 📊 组合汇总");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|:---|:---:|");
  lines.push(`| 总投入 | ${fmtMoney(summary.totalInvested)} |`);
  lines.push(`| 当前市值 | ${fmtMoney(summary.totalMarketValue)} |`);
  lines.push(`| 总盈亏 | ${fmtPct(summary.totalProfitPct)}（${fmtMoney(summary.totalProfit)}）|`);
  lines.push(`| 累计分红 | ${fmtMoney(summary.totalDividends)} |`);
  lines.push(`| 年化分红收入 | ${fmtMoney(summary.annualDividendIncome)} |`);
  lines.push(`| 成本股息率 | **${fmt(summary.dividendYieldOnCost)}%** |`);
  lines.push(`| 持仓数 | ${summary.positionCount} 只 |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 📡 市场温度表
  const { indices, asOf } = loadValuations();
  if (indices.length > 0) {
    lines.push("─── 📡 市场温度表 ───" + (asOf ? `（数据日期 ${asOf}）` : ""));
    lines.push("");
    for (const idx of indices) {
      const pct = idx.pct_5y ?? 50;
      const [marker, verdict] =
        pct >= 80 ? ["🔴", "⚠️ 偏高"] :
        pct >= 60 ? ["🟡", "中等偏上"] :
        pct >= 40 ? ["🔵", "适中"] :
        ["🟢", "偏低 ✅"];
      lines.push(`${marker} **${idx.name}** PE=${fmt(idx.pe, 2)} · 近5年${pct.toFixed(0)}%分位 · ${verdict}`);
    }
    lines.push("");
    lines.push("> 数据来源：中证指数 · PE百分位越低越便宜");
    lines.push("");
  }

  // 🎯 值得关注
  lines.push("─── 🎯 值得关注 ───");
  lines.push("");
  const candidates = indices.filter((i) => (i.pct_5y ?? 100) < 40).sort((a, b) => (a.pct_5y ?? 0) - (b.pct_5y ?? 0));
  if (candidates.length > 0) {
    lines.push("**📉 低估指数（百分位 < 40%），可关注相应 ETF：**");
    for (const idx of candidates) {
      lines.push(`- 🟢 **${idx.name}** (${idx.etf ?? "?"}) PE=${fmt(idx.pe, 2)} · ${(idx.pct_5y ?? 0).toFixed(0)}%分位 · ${idx.desc ?? ""}`);
    }
    lines.push("");
  }

  const divSorted = [...positions]
    .map((p) => ({ p, m: metrics.get(p.id)! }))
    .filter((x) => x.m.costYield > 1)
    .sort((a, b) => b.m.costYield - a.m.costYield)
    .slice(0, 5);
  lines.push("**💰 高股息持仓（按成本股息率排序）：**");
  if (divSorted.length > 0) {
    for (const { p, m } of divSorted) {
      lines.push(`- ${displayName(p)} (${p.stockCode}) 成本股息率 **${fmt(m.costYield, 1)}%** · 现价股息率 ${fmt(stockMap.get(p.stockCode)?.fundamentals?.dividendYield, 1)}%`);
    }
  } else {
    lines.push("- 暂无成本股息率 > 1% 的持仓");
  }
  lines.push("");

  // 💡 安全边际
  lines.push("─── 💡 安全边际分析 ───");
  lines.push("");
  for (const pos of positions) {
    const adv = adviceMap.get(pos.stockCode);
    const sd = stockMap.get(pos.stockCode);
    const price = sd?.quote.currentPrice ?? pos.buyPrice;
    const pe = adv?.pe ?? sd?.fundamentals?.pe;
    const grid = adv?.gridLevels ?? [];
    const buyLevels = grid.filter((g) => g.type === "buy");

    let peNote = "";
    if (pe != null && Number.isFinite(pe)) {
      peNote =
        pe <= 0 ? "⚪ PE亏损" :
        pe < 10 ? "🔵 PE偏低" : pe < 15 ? "🟢 PE适中" : pe < 25 ? "🟡 PE偏高" : "🔴 PE高";
    }
    let safety = "";
    if (buyLevels.length > 0 && price > 0) {
      const nearestBuy = Math.max(...buyLevels.map((g) => g.price));
      const dropPct = ((price - nearestBuy) / price) * 100;
      safety =
        dropPct > 20 ? `🔵 下行空间 ${dropPct.toFixed(0)}%（安全垫充足）` :
        dropPct > 10 ? `🟢 下行空间 ${dropPct.toFixed(0)}%` :
        dropPct > 5  ? `🟡 下行空间 ${dropPct.toFixed(0)}%（较薄）` :
                       `🔴 下行空间仅 ${dropPct.toFixed(0)}%（风险较高）`;
    }
    if (peNote || safety) {
      const parts = [`- **${displayName(pos)}**`];
      if (peNote) parts.push(peNote);
      if (safety) parts.push(safety);
      lines.push(parts.join(" · "));
    }
  }
  lines.push("");
  lines.push("💡 *操作建议仅供参考，不构成投资建议*");
  lines.push("");

  const content = lines.join("\n");
  writeReport(content);
  return { content, generatedAt: new Date().toISOString() };
}

function writeReport(content: string) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, content, "utf-8");
}
