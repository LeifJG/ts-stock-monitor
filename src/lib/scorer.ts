// ============================================================
// scorer.ts — 基本面综合评分引擎
// ============================================================
// 为每只股票计算 0-100 综合评分，用于排名和筛选。

import type { StockData } from "./types";

// ─── 评分权重 ───────────────────────────────────────────────
// 缺失数据的维度不参与加权（剩余权重归一化），避免港股/金融股被系统性压分。
const WEIGHTS: Record<keyof ScoreResult["breakdown"], number> = {
  dividendYield: 0.15,        // 股息率
  roe: 0.15,                  // ROE
  safety: 0.20,               // 安全边际（格雷厄姆核心）
  valuationPercentile: 0.10,  // 估值分位（PE 为主、PB 兜底，与交易建议引擎同口径）
  debtRatio: 0.05,            // 负债率（越低越好）
  pe: 0.10,                   // 绝对 PE（分位维度补足估值视角）
  fcfToNetProfit: 0.10,       // 盈利质量
  roic: 0.10,                 // 投入资本回报率
  grossMargin: 0.05,          // 毛利率
};

// ─── 单项评分函数（每个 0-100） ────────────────────────────

/** 股息率评分：越高越好，>8% 满分，5% 良好 */
function scoreDividendYield(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 8) return 100;
  if (v >= 5) return 60 + ((v - 5) / 3) * 40;
  if (v >= 3) return 30 + ((v - 3) / 2) * 30;
  if (v >= 1) return ((v - 1) / 2) * 30;
  return 0;
}

/** ROE 评分：越高越好，>25% 满分，15% 及格 */
function scoreROE(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 25) return 100;
  if (v >= 15) return 50 + ((v - 15) / 10) * 50;
  if (v >= 10) return 25 + ((v - 10) / 5) * 25;
  if (v >= 5) return ((v - 5) / 5) * 25;
  return 0;
}

/** 安全边际评分：直接使用已有评分 */
function scoreSafety(safetyScore: number | null | undefined): number {
  if (safetyScore == null) return 0;
  return Math.max(0, Math.min(100, safetyScore));
}

/** 负债率评分：越低越好，<30% 满分，>70% 零分 */
function scoreDebtRatio(v: number | null): number {
  if (v == null) return 50;
  if (v <= 30) return 100;
  if (v <= 50) return 70 + ((50 - v) / 20) * 30;
  if (v <= 70) return 30 + ((70 - v) / 20) * 40;
  return Math.max(0, 30 - ((v - 70) / 30) * 30);
}

/** PE 评分：越低越好，<10 满分，>40 零分，亏损股零分 */
function scorePE(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v <= 10) return 100;
  if (v <= 15) return 75 + ((15 - v) / 5) * 25;
  if (v <= 25) return 45 + ((25 - v) / 10) * 30;
  if (v <= 40) return 15 + ((40 - v) / 15) * 30;
  return Math.max(0, 15 - ((v - 40) / 40) * 15);
}

/** FCF/净利润比评分：>1.5 满分，>0.7 及格 */
function scoreFcfToNetProfit(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 1.5) return 100;
  if (v >= 1.2) return 70 + ((v - 1.2) / 0.3) * 30;  // 1.2→70, 1.5→100
  if (v >= 0.7) return 30 + ((v - 0.7) / 0.5) * 40;   // 0.7→30, 1.2→70
  if (v >= 0.3) return ((v - 0.3) / 0.4) * 30;         // 0.3→0, 0.7→30
  return 0;
}

/** ROIC 评分：>25% 满分，>10% 及格 */
function scoreROIC(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 25) return 100;
  if (v >= 15) return 60 + ((v - 15) / 10) * 40;  // 15%→60, 25%→100
  if (v >= 10) return 30 + ((v - 10) / 5) * 30;    // 10%→30, 15%→60
  if (v >= 5) return ((v - 5) / 5) * 30;            // 5%→0, 10%→30
  return 0;
}

/** 毛利率评分：>70% 满分，>30% 及格，<10% 零分 */
function scoreGrossMargin(v: number | null): number {
  if (v == null || v <= 0) return 0;
  if (v >= 70) return 100;
  if (v >= 40) return 50 + ((v - 40) / 30) * 50;   // 40%→50, 70%→100
  if (v >= 20) return 20 + ((v - 20) / 20) * 30;   // 20%→20, 40%→50
  if (v >= 10) return ((v - 10) / 10) * 20;         // 10%→0, 20%→20
  return 0;
}

/**
 * 估值分位评分：融合分位越低越好（历史低位 = 高分）。
 * 口径与 trade-advice.ts 完全一致：PE 为主、亏损股 PE 分位不可用回落 PB、齐备时 6:4 融合。
 * 线性映射：分位 0% → 100 分，100% → 0 分。
 */
function scoreValuationPercentile(
  valuation: { pe_pct_5y?: number; pb_pct_5y?: number } | undefined,
  pe: number | null
): number | null {
  if (!valuation) return null;
  const pePct = valuation.pe_pct_5y ?? null;
  const pbPct = valuation.pb_pct_5y ?? null;
  const effPePct = pe != null && pe > 0 ? pePct : null;
  const blended =
    effPePct != null && pbPct != null ? effPePct * 0.6 + pbPct * 0.4
    : (effPePct ?? pbPct);
  if (blended == null) return null;
  return Math.max(0, Math.min(100, 100 - blended));
}

// ─── 综合评分 ───────────────────────────────────────────────

export interface ScoreResult {
  total: number;
  grade: ScoreGrade;
  breakdown: {
    dividendYield: number | null;
    roe: number | null;
    safety: number | null;
    valuationPercentile: number | null;
    debtRatio: number | null;
    pe: number | null;
    fcfToNetProfit: number | null;
    roic: number | null;
    grossMargin: number | null;
  };
}

export type ScoreGrade = "优秀" | "良好" | "一般" | "较差";

function toGrade(score: number): ScoreGrade {
  if (score >= 70) return "优秀";
  if (score >= 50) return "良好";
  if (score >= 30) return "一般";
  return "较差";
}

/**
 * 计算单只股票的综合评分。
 * valuation 可选：传入后启用估值分位维度（推荐，与交易建议引擎口径一致）。
 * 数据缺失（null）的维度不参与加权，剩余维度权重归一化——
 * 港股（无负债率/FCF/ROIC/毛利率）与金融股（负债率特殊）不再被系统性压分。
 */
export function computeScore(stock: StockData, valuation?: { pe_pct_5y?: number; pb_pct_5y?: number }): ScoreResult {
  const { fundamentals, safetyScore } = stock;
  const pe = fundamentals.pe;

  // 各维度打分；null = 数据缺失 → 跳过该项（区分「缺数据」与「得 0 分」）
  const parts: { key: keyof ScoreResult["breakdown"]; score: number | null }[] = [
    { key: "dividendYield", score: fundamentals.dividendYield == null ? null : scoreDividendYield(fundamentals.dividendYield) },
    { key: "roe", score: fundamentals.roe == null ? null : scoreROE(fundamentals.roe) },
    { key: "safety", score: safetyScore?.score == null ? null : scoreSafety(safetyScore.score) },
    { key: "valuationPercentile", score: scoreValuationPercentile(valuation, pe) },
    { key: "debtRatio", score: fundamentals.debtRatio == null ? null : scoreDebtRatio(fundamentals.debtRatio) },
    // PE：null = 缺数据跳过；<=0 = 亏损是明确负面信号，计 0 分（估值分位维度已有 PB 兜底）
    { key: "pe", score: pe == null ? null : scorePE(pe) },
    { key: "fcfToNetProfit", score: fundamentals.fcfToNetProfit == null ? null : scoreFcfToNetProfit(fundamentals.fcfToNetProfit) },
    { key: "roic", score: fundamentals.roic == null ? null : scoreROIC(fundamentals.roic) },
    { key: "grossMargin", score: fundamentals.grossMargin == null ? null : scoreGrossMargin(fundamentals.grossMargin) },
  ];

  let weighted = 0;
  let weightSum = 0;
  for (const p of parts) {
    if (p.score == null) continue;
    weighted += p.score * WEIGHTS[p.key];
    weightSum += WEIGHTS[p.key];
  }
  const total = weightSum > 0 ? Math.round(weighted / weightSum) : 0;

  const breakdown = {} as ScoreResult["breakdown"];
  for (const p of parts) {
    breakdown[p.key] = p.score == null ? null : Math.round(p.score);
  }

  return { total, grade: toGrade(total), breakdown };
}

/** 批量计算所有股票评分（valuations: code → 估值分位数据，可选） */
export function computeAllScores(
  data: StockData[],
  valuations?: Map<string, { pe_pct_5y?: number; pb_pct_5y?: number }>
): Map<string, ScoreResult> {
  const map = new Map<string, ScoreResult>();
  for (const stock of data) {
    map.set(stock.quote.code, computeScore(stock, valuations?.get(stock.quote.code)));
  }
  return map;
}

// ─── 筛选条件类型 ───────────────────────────────────────────

export interface ScreenerFilters {
  peMin: number | null;
  peMax: number | null;
  dividendYieldMin: number | null;
  roeMin: number | null;
  roeMax: number | null;
  safetyScoreMin: number | null;
  pbMax: number | null;
  debtRatioMax: number | null;
  scoreMin: number | null;
  // ── 新增筛选 ──
  fcfToNetProfitMin: number | null;
  roicMin: number | null;
  grossMarginMin: number | null;
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  peMin: null, peMax: null, dividendYieldMin: null,
  roeMin: null, roeMax: null, safetyScoreMin: null,
  pbMax: null, debtRatioMax: null, scoreMin: null,
  fcfToNetProfitMin: null, roicMin: null, grossMarginMin: null,
};

/** 预设筛选条件 */
export const PRESETS: Record<string, { label: string; icon: string; filters: Partial<ScreenerFilters> }> = {
  value: {
    label: "价值股", icon: "💰",
    filters: { peMin: 0, peMax: 15, dividendYieldMin: 4, roeMin: 10, fcfToNetProfitMin: 0.7 },
  },
  highDividend: {
    label: "高股息", icon: "🎯",
    filters: { dividendYieldMin: 5, debtRatioMax: 60, fcfToNetProfitMin: 0.7 },
  },
  quality: {
    label: "盈利质量", icon: "💎",
    filters: { fcfToNetProfitMin: 1.0, roicMin: 15, grossMarginMin: 40, debtRatioMax: 50 },
  },
  bluechip: {
    label: "白马股", icon: "🦄",
    filters: { roeMin: 15, roicMin: 15, peMax: 25, debtRatioMax: 50, dividendYieldMin: 2, fcfToNetProfitMin: 0.7 },
  },
  safe: {
    label: "低风险", icon: "🛡️",
    filters: { debtRatioMax: 40, safetyScoreMin: 40, peMax: 20, fcfToNetProfitMin: 0.5 },
  },
};

/** 应用筛选条件，返回符合条件的股票代码集合 */
export function applyFilters(
  data: StockData[],
  scores: Map<string, ScoreResult>,
  filters: ScreenerFilters
): Set<string> {
  const matched = new Set<string>();

  for (const stock of data) {
    const { fundamentals, safetyScore } = stock;
    const code = stock.quote.code;
    const score = scores.get(code);
    let pass = true;

    if (filters.peMin != null && (fundamentals.pe == null || fundamentals.pe < filters.peMin)) pass = false;
    if (filters.peMax != null && (fundamentals.pe == null || fundamentals.pe > filters.peMax)) pass = false;
    if (filters.dividendYieldMin != null && (fundamentals.dividendYield == null || fundamentals.dividendYield < filters.dividendYieldMin)) pass = false;
    if (filters.roeMin != null && (fundamentals.roe == null || fundamentals.roe < filters.roeMin)) pass = false;
    if (filters.roeMax != null && (fundamentals.roe == null || fundamentals.roe > filters.roeMax)) pass = false;
    if (filters.safetyScoreMin != null && (safetyScore?.score == null || safetyScore.score < filters.safetyScoreMin)) pass = false;
    if (filters.pbMax != null && (fundamentals.pb == null || fundamentals.pb > filters.pbMax)) pass = false;
    if (filters.debtRatioMax != null && (fundamentals.debtRatio == null || fundamentals.debtRatio > filters.debtRatioMax)) pass = false;
    if (filters.scoreMin != null && (score == null || score.total < filters.scoreMin)) pass = false;
    if (filters.fcfToNetProfitMin != null && (fundamentals.fcfToNetProfit == null || fundamentals.fcfToNetProfit < filters.fcfToNetProfitMin)) pass = false;
    if (filters.roicMin != null && (fundamentals.roic == null || fundamentals.roic < filters.roicMin)) pass = false;
    if (filters.grossMarginMin != null && (fundamentals.grossMargin == null || fundamentals.grossMargin < filters.grossMarginMin)) pass = false;

    if (pass) matched.add(code);
  }

  return matched;
}
