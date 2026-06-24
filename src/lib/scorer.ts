// ============================================================
// scorer.ts — 基本面综合评分引擎
// ============================================================
// 为每只股票计算 0-100 综合评分，用于排名和筛选。

import type { StockData } from "./types";

// ─── 评分权重 ───────────────────────────────────────────────
const WEIGHTS = {
  dividendYield: 0.20,   // 股息率（略降，但仍重要）
  roe: 0.15,             // ROE（部分让给 ROIC）
  safety: 0.20,          // 安全边际
  debtRatio: 0.05,       // 负债率（降，已有 ROIC 覆盖风险维度）
  pe: 0.15,              // PE（降）
  fcfToNetProfit: 0.10,  // 盈利质量（新增）
  roic: 0.10,            // 投入资本回报率（新增）
  grossMargin: 0.05,     // 毛利率（新增）
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

// ─── 综合评分 ───────────────────────────────────────────────

export interface ScoreResult {
  total: number;
  grade: ScoreGrade;
  breakdown: {
    dividendYield: number;
    roe: number;
    safety: number;
    debtRatio: number;
    pe: number;
    fcfToNetProfit: number;
    roic: number;
    grossMargin: number;
  };
}

export type ScoreGrade = "优秀" | "良好" | "一般" | "较差";

function toGrade(score: number): ScoreGrade {
  if (score >= 70) return "优秀";
  if (score >= 50) return "良好";
  if (score >= 30) return "一般";
  return "较差";
}

/** 计算单只股票的综合评分 */
export function computeScore(stock: StockData): ScoreResult {
  const { fundamentals, safetyScore } = stock;

  const ds = scoreDividendYield(fundamentals.dividendYield);
  const rs = scoreROE(fundamentals.roe);
  const ss = scoreSafety(safetyScore?.score);
  const drs = scoreDebtRatio(fundamentals.debtRatio);
  const ps = scorePE(fundamentals.pe);
  const fs = scoreFcfToNetProfit(fundamentals.fcfToNetProfit);
  const ris = scoreROIC(fundamentals.roic);
  const gs = scoreGrossMargin(fundamentals.grossMargin);

  const total = Math.round(
    ds * WEIGHTS.dividendYield +
    rs * WEIGHTS.roe +
    ss * WEIGHTS.safety +
    drs * WEIGHTS.debtRatio +
    ps * WEIGHTS.pe +
    fs * WEIGHTS.fcfToNetProfit +
    ris * WEIGHTS.roic +
    gs * WEIGHTS.grossMargin
  );

  return {
    total,
    grade: toGrade(total),
    breakdown: {
      dividendYield: Math.round(ds),
      roe: Math.round(rs),
      safety: Math.round(ss),
      debtRatio: Math.round(drs),
      pe: Math.round(ps),
      fcfToNetProfit: Math.round(fs),
      roic: Math.round(ris),
      grossMargin: Math.round(gs),
    },
  };
}

/** 批量计算所有股票评分 */
export function computeAllScores(data: StockData[]): Map<string, ScoreResult> {
  const map = new Map<string, ScoreResult>();
  for (const stock of data) {
    map.set(stock.quote.code, computeScore(stock));
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
