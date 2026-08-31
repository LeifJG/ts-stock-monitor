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
  // 亏损股 PE 无效（负值），此时 PE 分位不可用 → 回落到 PB 分位
  const effPePct = pe != null && pe > 0 ? pePct5y : null;

  // 综合评分（用现有指标近似计算，避免循环依赖）
  const compositeScore = estimateCompositeScore(stock);

  // ── 安全边际
  const safetyMargin = safetyScore?.score ?? null;
  const grahamValue = safetyScore?.models?.growth?.value ?? safetyScore?.grahamNumber ?? null;
  const ddmValue = safetyScore?.models?.ddm?.value ?? null;
  let modelDivergent = false;

  // ── 合理估值：格雷厄姆增长版 / DDM ──
  // 两模型分歧 >50% 时取保守值（min），避免"均值掩盖分歧"
  let fairValue: number | null = null;
  const modelValues = [grahamValue, ddmValue].filter((v): v is number => v != null && v > 0);
  if (modelValues.length === 2) {
    const avg = (modelValues[0] + modelValues[1]) / 2;
    const divergence = Math.abs(modelValues[0] - modelValues[1]) / avg;
    if (divergence > 0.5) {
      fairValue = Math.min(...modelValues);
      modelDivergent = true;
    } else {
      fairValue = avg;
    }
  } else if (modelValues.length === 1) {
    fairValue = modelValues[0];
  }

  // ── 关键价位（以合理估值为锚，确保 加仓 < 合理估值 < 减仓 < 止盈 的单调关系）──
  let targetPrice: number | null;
  let addMorePrice: number | null;
  let reducePrice: number | null;
  if (fairValue != null && fairValue > 0) {
    if (fairValue > price) {
      // 低估：回落分批加仓，涨过合理估值分批兑现
      addMorePrice = round2(Math.min(price * 0.9, fairValue * 0.95));
      reducePrice = round2(fairValue * 1.1);
      targetPrice = round2(fairValue * 1.2);
    } else {
      // 现价已高于合理估值：等回落到合理区再加；若已超减仓线，直接提示减仓
      addMorePrice = round2(fairValue * 1.05);
      reducePrice = round2(Math.min(fairValue * 1.1, price * 1.05));
      targetPrice = round2(price * 1.08);
    }
  } else {
    // 无模型估值可用：退化为技术位
    targetPrice = round2(price * 1.12);
    addMorePrice = round2(price * 0.9);
    reducePrice = round2(price * 1.15);
  }

  // ── 风控位（基于买入价；仅作破位参考，低估区分批加仓优于止损）──
  // 估值分位极低（<10%）放宽到 -12%，极高位（>80%）收紧到 -6%
  let stopLossPct = 0.08;
  const effPctForStop = effPePct ?? pbPct5y;
  if (effPctForStop != null) {
    if (effPctForStop < 10) stopLossPct = 0.12;
    else if (effPctForStop > 80) stopLossPct = 0.06;
  }
  const stopLossPrice = round2(buyPrice * (1 - stopLossPct));

  // ── 决策逻辑 ──
  const reasons: string[] = [];
  const risks: string[] = [];

  // 1. 估值分位（核心权重）：PE 为主、PB 兜底，两者齐备时 6:4 融合
  let valuationScore = 50; // 未知 = 中性
  const pctForDecision =
    effPePct != null && pbPct5y != null
      ? effPePct * 0.6 + pbPct5y * 0.4
      : (effPePct ?? pbPct5y);
  if (pctForDecision != null) {
    const label =
      effPePct != null && pbPct5y != null
        ? `PE/PB 分位融合`
        : effPePct != null
          ? "PE 5年分位"
          : "PB 5年分位";
    if (pctForDecision < 15) { valuationScore = 90; reasons.push(`${label} ${pctForDecision.toFixed(0)}% — 处于历史低位区间`); }
    else if (pctForDecision < 35) { valuationScore = 75; reasons.push(`${label} ${pctForDecision.toFixed(0)}% — 偏低`); }
    else if (pctForDecision < 65) { valuationScore = 50; reasons.push(`${label} ${pctForDecision.toFixed(0)}% — 估值中枢`); }
    else if (pctForDecision < 85) { valuationScore = 30; risks.push(`${label} ${pctForDecision.toFixed(0)}% — 偏高`); }
    else { valuationScore = 15; risks.push(`${label} ${pctForDecision.toFixed(0)}% — 历史高位，追高风险大`); }
  }
  if (pe != null && pe < 0 && pbPct5y != null) {
    reasons.push(`亏损股 PE 无效，已按 PB 分位 ${pbPct5y.toFixed(0)}% 评估`);
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

  // 4. 股息率（防御性，参与加权——价值派核心指标之一）
  let dividendScore2 = 50; // 无分红数据 = 中性（成长股不罚分）
  if (dividendYield != null) {
    if (dividendYield >= 6) { dividendScore2 = 85; reasons.push(`股息率 ${dividendYield.toFixed(1)}% — 高股息防御性佳`); }
    else if (dividendYield >= 4) { dividendScore2 = 70; reasons.push(`股息率 ${dividendYield.toFixed(1)}% — 分红回报厚`); }
    else if (dividendYield >= 2.5) { dividendScore2 = 55; reasons.push(`股息率 ${dividendYield.toFixed(1)}% — 具备分红回报`); }
    else { dividendScore2 = 40; }
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
  // 四分量：估值分位 30% + 安全边际 25% + 综合评分 30% + 股息率 15%
  const total = valuationScore * 0.3 + safetyScore2 * 0.25 + qualityScore2 * 0.3 + dividendScore2 * 0.15;

  let action: TradeAction;
  if (total >= 76) action = "strongBuy";
  else if (total >= 60) action = "buy";
  else if (total >= 46) action = "hold";
  else if (total >= 33) action = "watch";
  else action = "avoid";

  // 低估建仓时，机械止损与价值逻辑矛盾 → 提示分批优于止损
  if ((action === "strongBuy" || action === "buy") && (pctForDecision ?? 100) < 35) {
    risks.push("低估区分批加仓优于止损，风控位仅作基本面破坏参考");
  }
  if (modelDivergent) {
    risks.push("两套估值模型分歧较大，已取保守值，估值置信度低");
  }

  const meta = ACTION_META[action];

  // ── 一句话结论 ──
  const ccy = isAShare(code) ? "¥" : "HK$";
  const summary = buildSummary(action, price, fairValue, pePct5y, dividendYield, ccy);

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
  // 负债率（越低越好，<30% 满分；金融股负债率 90%+ 是行业常态，跳过该项）
  if (f.debtRatio != null && !isFinancial(stock.quote.code)) {
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
  dividendYield: number | null,
  ccy: string = "¥"
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
    parts.push(`模型合理估值约 ${ccy}${fairValue.toFixed(1)}，较现价有 ${(((fairValue - price) / price) * 100).toFixed(0)}% 空间`);
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

  // 与主函数 computeTradeAdvice 同一口径：分位 <10% 放宽、>80% 收紧
  const effPct = valuation?.pe_pct_5y ?? valuation?.pb_pct_5y ?? null;
  if (effPct != null) {
    if (effPct < 10) { tpPct = 0.3; slPct = 0.12; }
    else if (effPct > 80) { tpPct = 0.15; slPct = 0.06; }
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
