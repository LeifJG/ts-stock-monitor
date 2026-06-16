// ============================================================
// indicators.ts — 安全边际评分 & 恐慌指数计算
// ============================================================
// 纯函数，给定基础数据返回计算后的指标，无副作用。

import type { SafetyScore, SafetyGrade, FearGauge, StockQuote, StockFundamentals } from "./types";

// ─── 安全边际评分（格雷厄姆估值法）─────────────────────────────

/**
 * 格雷厄姆估值 = √(22.5 × EPS × BVPS)  — 保守，适合低PB价值股
 * ROE修正估值 = EPS × 合理PE             — 含盈利能力溢价，适合白马股
 *   合理PE = min(20, 8 + ROE/2)          — ROE越高给越高倍数
 *
 * EPS 和 BVPS 从 PE/PB 反推：
 *   EPS = 当前价 / PE
 *   BVPS = 当前价 / PB
 *
 * 两个版本都按同一规则评分：
 *   安全边际% = (估值 - 当前价) / 估值 × 100%
 *   评分 0-100：安全边际 ≥ 50% → 100，≤ 0% → 0
 */
export function calcSafetyScore(
  price: number,
  pe: number | null,
  pb: number | null,
  roe?: number | null   // ROE(%)，可选，用于修正版
): SafetyScore {
  const empty = {
    grahamNumber: null, marginOfSafety: null, score: null, grade: "未知" as SafetyGrade,
    roeAdjustedValue: null, roeMarginOfSafety: null, roeScore: null, roeGrade: "未知" as SafetyGrade,
  };

  if (!pe || !pb || pe <= 0 || pb <= 0 || price <= 0) return empty;

  const eps = price / pe;
  const bvps = price / pb;

  // ── 保守版：格雷厄姆原版 ────────────────────────────
  const grahamNumber = Math.sqrt(22.5 * eps * bvps);
  const marginOfSafety = ((grahamNumber - price) / grahamNumber) * 100;
  const rawScore = (marginOfSafety / 50) * 100;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let grade: SafetyGrade;
  if (marginOfSafety >= 30) grade = "优秀";
  else if (marginOfSafety >= 15) grade = "良好";
  else if (marginOfSafety > 0) grade = "一般";
  else grade = "危险";

  // ── 修正版：ROE调整 ────────────────────────────────
  let roeAdjustedValue: number | null = null;
  let roeMarginOfSafety: number | null = null;
  let roeScore: number | null = null;
  let roeGrade: SafetyGrade = "未知";

  if (roe != null && roe > 0) {
    // 合理PE = min(20, 8 + ROE/2)，ROE=20% → PE=18，ROE=10% → PE=13
    const reasonablePE = Math.min(20, Math.max(8, 8 + roe / 2));
    roeAdjustedValue = eps * reasonablePE;
    roeMarginOfSafety = ((roeAdjustedValue - price) / roeAdjustedValue) * 100;
    const rawRoeScore = (roeMarginOfSafety / 50) * 100;
    roeScore = Math.max(0, Math.min(100, Math.round(rawRoeScore)));

    if (roeMarginOfSafety >= 30) roeGrade = "优秀";
    else if (roeMarginOfSafety >= 15) roeGrade = "良好";
    else if (roeMarginOfSafety > 0) roeGrade = "一般";
    else roeGrade = "危险";
  }

  return {
    grahamNumber: Math.round(grahamNumber * 100) / 100,
    marginOfSafety: Math.round(marginOfSafety * 100) / 100,
    score,
    grade,
    roeAdjustedValue: roeAdjustedValue != null ? Math.round(roeAdjustedValue * 100) / 100 : null,
    roeMarginOfSafety: roeMarginOfSafety != null ? Math.round(roeMarginOfSafety * 100) / 100 : null,
    roeScore,
    roeGrade,
  };
}

// ─── 恐慌指数（单只股票 · 基于实时数据）────────────────────────

/**
 * 恐慌指数 0-100，越高越恐慌：
 *
 * 三个分量（无需 kline 历史，基于实时行情计算）：
 *   1. 日内涨跌幅（35%）— 大跌 = 恐慌
 *   2. 日内振幅（35%）— 剧烈波动 = 恐慌
 *   3. 换手率（30%）— 高换手 = 恐慌
 *
 * 标签：
 *   0-20  极度贪婪 😎
 *   20-40 贪婪 😊
 *   40-60 中性 😐
 *   60-80 恐慌 😰
 *   80-100 极度恐慌 😱
 */
export function calcFearGauge(
  changePercent: number,
  high: number,
  low: number,
  prevClose: number,
  turnoverRate: number | null
): FearGauge {
  // 1. 涨跌幅得分（35%）
  //   -5% → 100, 0% → 50, +5% → 0
  const changeScore = Math.max(0, Math.min(100,
    50 - (changePercent * 10)
  ));

  // 2. 日内振幅得分（35%）
  //   振幅 5%+ → 100, 振幅 1% → 0
  let amplitude = 0;
  if (prevClose > 0 && high > 0 && low > 0) {
    amplitude = ((high - low) / prevClose) * 100;
  }
  const amplitudeScore = Math.max(0, Math.min(100,
    (amplitude / 5) * 100
  ));

  // 3. 换手率得分（30%）
  //   换手 10%+ → 100, 换手 1% → 0
  let turnoverScore = 50; // 默认中性
  if (turnoverRate != null && turnoverRate > 0) {
    turnoverScore = Math.max(0, Math.min(100,
      (turnoverRate / 10) * 100
    ));
  }

  // 综合
  const overall = Math.round(
    changeScore * 0.35 + amplitudeScore * 0.35 + turnoverScore * 0.30
  );

  // 标签
  let label: string;
  if (overall < 20) label = "极度贪婪 😎";
  else if (overall < 40) label = "贪婪 😊";
  else if (overall < 60) label = "中性 😐";
  else if (overall < 80) label = "恐慌 😰";
  else label = "极度恐慌 😱";

  return {
    overall,
    drawdown: Math.round(changeScore),
    rsi: Math.round(amplitudeScore),
    macd: Math.round(turnoverScore),
    label,
  };
}

/** 恐慌指数 → Tailwind 文本颜色 */
export function fearGaugeColor(score: number): string {
  if (score < 20) return "text-green-500";
  if (score < 40) return "text-emerald-400";
  if (score < 60) return "text-yellow-500";
  if (score < 80) return "text-orange-500";
  return "text-red-500";
}

/** 恐慌指数 → Tailwind 背景色 */
export function fearGaugeBg(score: number): string {
  if (score < 20) return "bg-green-50 border-green-200";
  if (score < 40) return "bg-emerald-50 border-emerald-200";
  if (score < 60) return "bg-yellow-50 border-yellow-200";
  if (score < 80) return "bg-orange-50 border-orange-200";
  return "bg-red-50 border-red-200";
}

/** 安全边际评分 → Tailwind 文本颜色 */
export function safetyScoreColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-blue-600";
  if (score >= 10) return "text-yellow-600";
  return "text-red-600";
}
