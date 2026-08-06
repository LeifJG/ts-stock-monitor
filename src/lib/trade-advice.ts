// ============================================================
// trade-advice.ts — 交易建议引擎
// ============================================================
// 结合行情、基本面、估值模型（格雷厄姆/DDM）、估值分位，
// 生成买入操作建议、止盈价、止损价、加仓/减仓参考位。
// 纯函数模块，供 PortfolioPanel（添加持仓弹窗）使用。

import type { StockData } from "./types";
import type { ValuationData } from "@/app/api/valuation/route";

// ─── 类型 ───────────────────────────────────────────────────

export type TradeAction = "strongBuy" | "buy" | "hold" | "watch" | "avoid";

export interface TradeAdvice {
  code: string;
  name: string;
  action: TradeAction;
  actionLabel: string;
  actionColor: string;
  summary: string;            // 一句话结论
  // ── 关键价位 ──
  currentPrice: number;       // 现价
  fairValue: number | null;   // 合理估值（元）
  targetPrice: number | null; // 止盈价（目标价）
  stopLossPrice: number | null; // 止损价
  addMorePrice: number | null;  // 加仓参考价
  reducePrice: number | null;   // 减仓参考价
  // ── 决策依据 ──
  reasons: string[];          // 支持理由
  risks: string[];            // 风险提示
  // ── 数据摘要 ──
  pe: number | null;
  pePercentile5y: number | null;
  pb: number | null;
  pbPercentile5y: number | null;
  dividendYield: number | null;
  roe: number | null;
  compositeScore: number | null;
  safetyMargin: number | null;  // 安全边际 %
  fearGauge: number | null;     // 恐慌指数
}

// ─── 颜色配置 ───────────────────────────────────────────────

export const ACTION_META: Record<TradeAction, { label: string; color: string }> = {
  strongBuy: { label: "强烈买入", color: "#ef4444" },
  buy:       { label: "建议买入", color: "#f97316" },
  hold:      { label: "持有观察", color: "#3b82f6" },
  watch:     { label: "谨慎观望", color: "#f59e0b" },
  avoid:     { label: "建议回避", color: "#6b7280" },
};

// ─── 工具 ───────────────────────────────────────────────────

function round2(v: number | null | undefined): number | null {
  if (v == null || !isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/** 判断代码是否 A 股（沪/深/北） */
function isAShare(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** 银行/保险/券商（金融股负债率特殊，评分时放宽） */
const FINANCIAL_RE = /^(6000|6001|6010|6011|6012|6013|6016|6019|0000|0001|0021)/;
function isFinancial(code: string): boolean {
  return FINANCIAL_RE.test(code);
}

// ─── 主函数 ─────────────────────────────────────────────────

export function computeTradeAdvice(
  stock: StockData | undefined,
  valuation: ValuationData | undefined,
  opts?: { buyPrice?: number }
): TradeAdvice | null {
  if (!stock) return null;

  const { quote, fundamentals, safetyScore, fearGauge } = stock;
  const code = quote.code;
  const name = quote.name;
  const price = quote.currentPrice;
  const buyPrice = opts?.buyPrice || price;

  // ── 数据准备 ──
  const pe = fundamentals.pe;
  const pb = fundamentals.pb;
  const dividendYield = fundamentals.dividendYield;
  const roe = fundamentals.roe;
  const fear = fearGauge?.overall ?? null;
  const pePct5y = valuation?.pe_pct_5y ?? null;
  const pbPct5y = valuation?.pb_pct_5y ?? null;

  // 综合评分（用现有指标近似计算，避免循环依赖）
  const compositeScore = estimateCompositeScore(stock);

  // 安全边际
  const safetyMargin = safetyScore?.score ?? null;
  const grahamValue = safetyScore?.models?.growth?.value ?? safetyScore?.grahamNumber ?? null;
  const ddmValue = safetyScore?.models?.ddm?.value ?? null;

  // ── 合理估值：取格雷厄姆增长版 / DDM 的中间值 ──
  let fairValue: number | null = null;
  const modelValues = [grahamValue, ddmValue].filter((v): v is number => v != null && v > 0);
  if (modelValues.length > 0) {
    fairValue = modelValues.reduce((a, b) => a + b, 0) / modelValues.length;
  }

  // ── 止盈价（目标价）──
  // 优先用合理估值；若合理估值高于现价，止盈 = 合理估值 × 0.95（留缓冲）
  // 若合理估值低于现价，止盈 = 现价 × 1.15（技术面反弹目标）
  let targetPrice: number | null = null;
  if (fairValue != null && fairValue > price) {
    targetPrice = fairValue * 0.95;
  } else if (fairValue != null && fairValue < price) {
    targetPrice = price * 1.15;
  } else {
    targetPrice = price * 1.12;
  }

  // ── 止损价：基于买入价的 -8%（个股波动控制） ──
  // 若估值分位极低（<10%）可放宽到 -12%，极高位（>80%）收紧到 -6%
  let stopLossPct = 0.08;
  if (pePct5y != null) {
    if (pePct5y < 10) stopLossPct = 0.12;
    else if (pePct5y > 80) stopLossPct = 0.06;
  }
  const stopLossPrice = round2(buyPrice * (1 - stopLossPct));

  // ── 加仓价：回落到合理估值附近或现价 -10% ──
  let addMorePrice: number | null = null;
  if (fairValue != null && fairValue < price) {
    addMorePrice = round2(fairValue * 1.05);
  } else {
    addMorePrice = round2(price * 0.9);
  }

  // ── 减仓价：接近合理估值上限或现价 +15% ──
  let reducePrice: number | null = null;
  if (fairValue != null && fairValue > price) {
    reducePrice = round2(fairValue * 1.1);
  } else {
    reducePrice = round2(price * 1.15);
  }

  // ── 决策逻辑 ──
  const reasons: string[] = [];
  const risks: string[] = [];

  // 1. 估值分位（核心）
  let valuationScore = 50; // 未知 = 中性
  if (pePct5y != null) {
    if (pePct5y < 15) { valuationScore = 90; reasons.push(`PE 5年分位 ${pePct5y}% — 处于历史低位区间`); }
    else if (pePct5y < 35) { valuationScore = 75; reasons.push(`PE 5年分位 ${pePct5y}% — 偏低`); }
    else if (pePct5y < 65) { valuationScore = 50; reasons.push(`PE 5年分位 ${pePct5y}% — 估值中枢`); }
    else if (pePct5y < 85) { valuationScore = 30; risks.push(`PE 5年分位 ${pePct5y}% — 偏高`); }
    else { valuationScore = 15; risks.push(`PE 5年分位 ${pePct5y}% — 历史高位，追高风险大`); }
  }

  // 2. 安全边际
  let safetyScore2 = 50;
  if (safetyMargin != null) {
    if (safetyMargin > 40) { safetyScore2 = 85; reasons.push(`安全边际 ${safetyMargin.toFixed(0)}% — 价格低于内在价值`); }
    else if (safetyMargin > 15) { safetyScore2 = 65; reasons.push(`安全边际 ${safetyMargin.toFixed(0)}% — 有一定保护`); }
    else if (safetyMargin < -20) { safetyScore2 = 20; risks.push(`安全边际 ${safetyMargin.toFixed(0)}% — 价格高于内在价值`); }
    else { safetyScore2 = 45; }
  }

  // 3. 综合评分
  let qualityScore2 = 50;
  if (compositeScore != null) {
    if (compositeScore >= 70) { qualityScore2 = 90; reasons.push(`综合评分 ${compositeScore} — 基本面优秀`); }
    else if (compositeScore >= 50) { qualityScore2 = 70; reasons.push(`综合评分 ${compositeScore} — 基本面良好`); }
    else if (compositeScore >= 30) { qualityScore2 = 45; risks.push(`综合评分 ${compositeScore} — 基本面一般`); }
    else { qualityScore2 = 25; risks.push(`综合评分 ${compositeScore} — 基本面较弱`); }
  }

  // 4. 股息率（防御性）
  if (dividendYield != null) {
    if (dividendYield >= 5) reasons.push(`股息率 ${dividendYield.toFixed(1)}% — 高股息防御性佳`);
    else if (dividendYield >= 3) reasons.push(`股息率 ${dividendYield.toFixed(1)}% — 具备分红回报`);
  }

  // 5. 恐慌指数（情绪面）
  if (fear != null) {
    if (fear >= 65) reasons.push(`恐慌指数 ${fear.toFixed(0)} — 市场情绪恐慌，或为低吸窗口`);
    else if (fear <= 35) risks.push(`恐慌指数 ${fear.toFixed(0)} — 市场情绪偏热，警惕回调`);
  }

  // 6. PB 破净（银行股尤其适用）
  if (pb != null && pb < 1 && !isFinancial(code)) {
    reasons.push(`PB ${pb.toFixed(2)} — 破净状态，安全边际厚`);
  } else if (pb != null && pb < 1 && isFinancial(code)) {
    reasons.push(`PB ${pb.toFixed(2)} — 破净（金融股常见，注意资产质量）`);
  }

  // ── 综合判定 ──
  const total = valuationScore * 0.35 + safetyScore2 * 0.3 + qualityScore2 * 0.35;

  let action: TradeAction;
  if (total >= 78) action = "strongBuy";
  else if (total >= 62) action = "buy";
  else if (total >= 48) action = "hold";
  else if (total >= 35) action = "watch";
  else action = "avoid";

  const meta = ACTION_META[action];

  // ── 一句话结论 ──
  const summary = buildSummary(action, price, fairValue, pePct5y, dividendYield);

  return {
    code,
    name,
    action,
    actionLabel: meta.label,
    actionColor: meta.color,
    summary,
    currentPrice: round2(price) ?? price,
    fairValue: round2(fairValue),
    targetPrice: round2(targetPrice),
    stopLossPrice,
    addMorePrice,
    reducePrice,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 4),
    pe,
    pePercentile5y: pePct5y,
    pb,
    pbPercentile5y: pbPct5y,
    dividendYield,
    roe,
    compositeScore,
    safetyMargin: round2(safetyMargin),
    fearGauge: fear != null ? Math.round(fear) : null,
  };
}

// ─── 内部辅助 ───────────────────────────────────────────────

/** 用现有基本面数据近似综合评分（0-100），避免依赖 scorer 造成循环 */
function estimateCompositeScore(stock: StockData): number | null {
  const f = stock.fundamentals;
  if (!f) return null;

  let score = 0;
  let weight = 0;

  // 股息率（满分 8%+）
  if (f.dividendYield != null) {
    score += Math.min(f.dividendYield / 8, 1) * 100 * 0.2;
    weight += 0.2;
  }
  // ROE（满分 25%+）
  if (f.roe != null) {
    score += Math.min(f.roe / 25, 1) * 100 * 0.15;
    weight += 0.15;
  }
  // 安全边际
  if (stock.safetyScore?.score != null) {
    score += stock.safetyScore.score * 0.2;
    weight += 0.2;
  }
  // 负债率（越低越好，<30% 满分）
  if (f.debtRatio != null) {
    const dr = Math.min(Math.max(f.debtRatio, 0), 70);
    score += (1 - dr / 70) * 100 * 0.05;
    weight += 0.05;
  }
  // PE（<10 满分）
  if (f.pe != null && f.pe > 0) {
    score += Math.min(Math.max(10 / f.pe, 0), 1) * 100 * 0.15;
    weight += 0.15;
  }
  // FCF/净利
  if (f.fcfToNetProfit != null) {
    score += Math.min(f.fcfToNetProfit / 1.5, 1) * 100 * 0.1;
    weight += 0.1;
  }
  // ROIC
  if (f.roic != null) {
    score += Math.min(f.roic / 25, 1) * 100 * 0.1;
    weight += 0.1;
  }
  // 毛利率
  if (f.grossMargin != null) {
    score += Math.min(f.grossMargin / 70, 1) * 100 * 0.05;
    weight += 0.05;
  }

  if (weight === 0) return null;
  return Math.round(score / weight);
}

function buildSummary(
  action: TradeAction,
  price: number,
  fairValue: number | null,
  pePct5y: number | null,
  dividendYield: number | null
): string {
  const base = {
    strongBuy: "估值处于历史低位且基本面优秀，当前具备较强安全边际，可分批建仓",
    buy: "估值合理偏低，基本面良好，可逢低分批买入",
    hold: "估值与基本面匹配，若已持仓可继续持有，暂不建议追高",
    watch: "估值偏高或基本面存疑，建议等待更合适的价位",
    avoid: "估值处于历史高位或基本面偏弱，不建议此时买入",
  }[action];

  const parts = [base];
  if (fairValue != null && fairValue > price) {
    parts.push(`模型合理估值约 ¥${fairValue.toFixed(1)}，较现价有 ${(((fairValue - price) / price) * 100).toFixed(0)}% 空间`);
  }
  if (pePct5y != null && pePct5y < 30) {
    parts.push(`估值分位仅 ${pePct5y}%`);
  }
  if (dividendYield != null && dividendYield >= 5) {
    parts.push(`股息率 ${dividendYield.toFixed(1)}% 提供安全垫`);
  }
  return parts.join("；") + "。";
}

/** 根据买入价生成持仓侧止盈/止损（区别于建仓时的建议） */
export function computePositionLevels(
  buyPrice: number,
  stock?: StockData,
  valuation?: ValuationData
): { takeProfit: number; stopLoss: number; note: string } {
  let tpPct = 0.2;   // 默认止盈 +20%
  let slPct = 0.08;  // 默认止损 -8%

  if (valuation?.pe_pct_5y != null) {
    if (valuation.pe_pct_5y < 20) { tpPct = 0.3; slPct = 0.1; }   // 低估：放宽
    else if (valuation.pe_pct_5y > 80) { tpPct = 0.15; slPct = 0.06; } // 高估：收紧
  }
  // 高股息给更宽的止损容忍
  if (stock?.fundamentals.dividendYield != null && stock.fundamentals.dividendYield >= 5) {
    slPct = Math.min(slPct + 0.02, 0.12);
  }

  const note = `基于买入价 ¥${buyPrice.toFixed(2)} 计算：目标 +${(tpPct * 100).toFixed(0)}%，止损 -${(slPct * 100).toFixed(0)}%`;
  return {
    takeProfit: round2(buyPrice * (1 + tpPct)) ?? buyPrice * 1.2,
    stopLoss: round2(buyPrice * (1 - slPct)) ?? buyPrice * 0.92,
    note,
  };
}
