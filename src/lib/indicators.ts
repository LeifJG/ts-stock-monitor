// ============================================================
// indicators.ts — 安全边际评分 & 恐慌指数计算
// ============================================================
// 纯函数，给定基础数据返回计算后的指标，无副作用。

import type { SafetyScore, SafetyGrade, FearGauge, StockQuote, StockFundamentals } from "./types";

// ─── 安全边际评分（三模型集成）────────────────────────────────

/**
 * 安全边际评分（三模型集成）
 *
 * 数据来源（全部来自现有字段）：
 *   - 格雷厄姆原版: PE, PB (已有)
 *   - 格雷厄姆增长版: PE, ROE, 分红率 (已有或估算)
 *   - 股息贴现模型: 每股分红, ROE, 分红率 (已有或估算)
 *
 * 增长因子: g = ROE × (1 - 分红率)
 *   分红率 = dividendPayoutRatio / 100 (如有真实分红率)
 *   无真实分红率时: ROE>20%→0.45, ROE>15%→0.40, ROE>10%→0.35, 否则0.30
 *
 * 综合评分 = 已激活模型的加权平均
 *   格雷厄姆(30%) + 增长版(40%) + DDM(30%)
 */
export function calcSafetyScore(
  price: number,
  pe: number | null,
  pb: number | null,
  roe?: number | null,
  extras?: {                 // 可选补充数据
    dividendYield?: number | null;    // 股息率(%)
    dividendPayoutRatio?: number | null; // 分红率(%)
    dividendPerShare?: number | null;   // 每股分红(元)
  } | null
): SafetyScore {
  // ── 推算 EPS / BVPS ──────────────────────────────────────
  let eps: number | null = null;
  let bvps: number | null = null;
  if (pe && pe > 0) eps = price / pe;
  if (pb && pb > 0) bvps = price / pb;

  // ── 推算增长率 g ─────────────────────────────────────────
  // 分红率优先使用真实的，否则按 ROE 估算
  let payoutRatio: number | null = null;
  if (extras?.dividendPayoutRatio != null && extras.dividendPayoutRatio > 0 && extras.dividendPayoutRatio < 100) {
    payoutRatio = extras.dividendPayoutRatio / 100;
  } else if (roe != null && roe > 0) {
    if (roe > 20) payoutRatio = 0.45;
    else if (roe > 15) payoutRatio = 0.40;
    else if (roe > 10) payoutRatio = 0.35;
    else if (roe > 5) payoutRatio = 0.30;
    else payoutRatio = 0.25;
  }

  // g = ROE × (1 - 分红率)
  let g: number | null = null;
  if (roe != null && roe > 0 && payoutRatio != null) {
    g = roe * (1 - payoutRatio);
  }

  // ── 每股分红（优先用传入值，其次从股息率反推） ─────────
  let dps: number | null = extras?.dividendPerShare ?? null;
  if (dps == null && extras?.dividendYield != null && extras.dividendYield > 0 && price > 0) {
    dps = (extras.dividendYield / 100) * price;
  }

  // ── 评分辅助函数 ─────────────────────────────────────────
  const calcScore = (margin: number): number =>
    Math.max(0, Math.min(100, Math.round((margin / 50) * 100)));

  const calcGrade = (margin: number): SafetyGrade => {
    if (margin >= 30) return "优秀";
    if (margin >= 15) return "良好";
    if (margin > 0) return "一般";
    return "危险";
  };

  // ── 模型 1：格雷厄姆原版 ─────────────────────────────────
  let grahamModel: { value: number; margin: number; score: number } | null = null;
  if (eps != null && bvps != null && eps > 0 && bvps > 0) {
    const value = Math.sqrt(22.5 * eps * bvps);
    const margin = ((value - price) / value) * 100;
    grahamModel = {
      value: Math.round(value * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      score: calcScore(margin),
    };
  }

  // ── 模型 2：格雷厄姆增长版 ──────────────────────────────
  //   EPS × (8.5 + 2g) — 格雷厄姆《聪明的投资者》公式
  let growthModel: { value: number; margin: number; score: number; g: number } | null = null;
  if (eps != null && eps > 0 && g != null && g > 0) {
    const fairPE = Math.min(25, Math.max(5, 8.5 + 2 * g));
    const value = eps * fairPE;
    const margin = ((value - price) / value) * 100;
    growthModel = {
      value: Math.round(value * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      score: calcScore(margin),
      g: Math.round(g * 100) / 100,
    };
  }

  // ── 模型 3：股息贴现模型（DDM） ─────────────────────────
  //   DDM = 股息 / (r - g)，r = 8%（A股要求回报率）
  //   当 g >= r 时用 10 年分段模型
  let ddmModel: { value: number; margin: number; score: number; g: number } | null = null;
  if (dps != null && dps > 0 && g != null) {
    const r = 0.08; // A 股要求回报率
    let value: number;
    if (g < r) {
      // 永续增长模型
      value = dps / (r - g * 0.01); // g 是百分数，转小数
    } else {
      // 10年分段 + 终端估值
      let pv = 0;
      let currentDiv = dps;
      for (let y = 1; y <= 10; y++) {
        currentDiv *= (1 + g * 0.01);
        pv += currentDiv / Math.pow(1 + r, y);
      }
      // 终端价值：10年后以 4% 永续增长
      const terminalDiv = currentDiv * 1.04;
      const terminalValue = terminalDiv / (r - 0.04);
      pv += terminalValue / Math.pow(1 + r, 10);
      value = pv;
    }
    const margin = ((value - price) / value) * 100;
    ddmModel = {
      value: Math.round(value * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      score: calcScore(margin),
      g: Math.round(g * 100) / 100,
    };
  }

  // ── 综合评分（加权平均，只有可用模型参与） ──────────────
  const activeModels: { score: number; weight: number }[] = [];
  if (grahamModel) activeModels.push({ score: grahamModel.score, weight: 30 });
  if (growthModel) activeModels.push({ score: growthModel.score, weight: 40 });
  if (ddmModel) activeModels.push({ score: ddmModel.score, weight: 30 });

  let compositeScore: number | null = null;
  let compositeGrade: SafetyGrade = "未知";
  if (activeModels.length > 0) {
    const totalWeight = activeModels.reduce((s, m) => s + m.weight, 0);
    compositeScore = Math.round(
      activeModels.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight
    );
    compositeGrade = calcGrade(compositeScore / 100 * 50 - 0); // score → margin
    // 简化：直接用 score 转 grade
    if (compositeScore >= 60) compositeGrade = "优秀";
    else if (compositeScore >= 40) compositeGrade = "良好";
    else if (compositeScore >= 20) compositeGrade = "一般";
    else compositeGrade = "危险";
  }

  // ── 返回 ─────────────────────────────────────────────────
  return {
    // 原字段兼容
    grahamNumber: grahamModel?.value ?? null,
    marginOfSafety: grahamModel?.margin ?? null,
    score: compositeScore,
    grade: compositeGrade,
    roeAdjustedValue: growthModel?.value ?? null,
    roeMarginOfSafety: growthModel?.margin ?? null,
    roeScore: growthModel?.score ?? null,
    roeGrade: growthModel?.score != null ? calcGrade(growthModel.margin) : "未知",

    // 新模型
    grahamGrowthValue: growthModel?.value ?? null,
    grahamGrowthMargin: growthModel?.margin ?? null,
    grahamGrowthScore: growthModel?.score ?? null,
    grahamGrowthGrade: growthModel?.score != null ? calcGrade(growthModel.margin) : "未知",

    ddmValue: ddmModel?.value ?? null,
    ddmMargin: ddmModel?.margin ?? null,
    ddmScore: ddmModel?.score ?? null,
    ddmGrade: ddmModel?.score != null ? calcGrade(ddmModel.margin) : "未知",

    models: { graham: grahamModel, growth: growthModel, ddm: ddmModel },
  };
}

// ─── 恐慌指数（单只股票 · 多时间维度）───────────────────────────

/**
 * 恐慌指数 0-100，越高越恐慌：
 *
 * 五个分量（当有历史 K 线数据时）：
 *   1. 均线位置（25%）— 价格偏离20日均线，越低越恐慌
 *   2. RSI(14)（20%）— 经典超买超卖指标
 *   3. 量比（20%）— 今日量/20日均量，放量=恐慌
 *   4. 5日涨跌（20%）— 中期走势
 *   5. 振幅比（15%）— 今日振幅/20日平均振幅
 *
 * 降级方案（无历史数据时）：
 *   1. 日内涨跌幅（35%）— 大跌=恐慌
 *   2. 日内振幅（35%）— 剧烈波动=恐慌
 *   3. 换手率（30%）— 高换手=恐慌
 *
 * 标签：0-20 😎 极度贪婪, 20-40 😊 贪婪, 40-60 😐 中性,
 *       60-80 😰 恐慌, 80-100 😱 极度恐慌
 */
export function calcFearGauge(
  changePercent: number,
  high: number,
  low: number,
  prevClose: number,
  turnoverRate: number | null,
  tech?: {               // 可选的历史技术指标（来自 fear_tech_cache）
    rsi14?: number | null;
    priceVsMa20Pct?: number | null;
    volumeRatio?: number | null;
    change5dPct?: number | null;
    amplitudeRatio?: number | null;
  } | null
): FearGauge {
  let overall: number;
  let changeScore: number;
  let amplitudeScore: number;
  let turnoverScore: number;
  let rsi14Val: number | undefined;
  let ma20Val: number | undefined;
  let priceVsMa20Val: number | undefined;
  let volumeRatioVal: number | undefined;
  let change5dVal: number | undefined;
  let amplitudeRatioVal: number | undefined;

  // ── 当有历史技术指标时（优先使用） ─────────────────────────
  if (tech && (tech.rsi14 != null || tech.priceVsMa20Pct != null)) {
    // 1. 均线位置得分（25%）— 价格低于MA20越多越恐慌
    //    -10% → 100, 0% → 50, +10% → 0
    const maScore = tech.priceVsMa20Pct != null
      ? Math.max(0, Math.min(100, 50 - tech.priceVsMa20Pct * 5))
      : 50;

    // 2. RSI得分（20%）— RSI越低越恐慌
    //    RSI 20 → 100, RSI 50 → 50, RSI 80 → 0
    const rsiScore = tech.rsi14 != null
      ? Math.max(0, Math.min(100, 100 - tech.rsi14 * 1.25))
      : 50;

    // 3. 量比得分（20%）— 放量越大越恐慌
    //    量比 3 → 100, 量比 1 → 30, 量比 0.5 → 0
    const volScore = tech.volumeRatio != null
      ? Math.max(0, Math.min(100, (Math.min(tech.volumeRatio, 4) - 0.3) / 3.7 * 100))
      : 50;

    // 4. 5日涨跌得分（20%）— 跌越多越恐慌
    //    -10% → 100, 0% → 50, +10% → 0
    const chg5dScore = tech.change5dPct != null
      ? Math.max(0, Math.min(100, 50 - tech.change5dPct * 5))
      : 50;

    // 5. 振幅比得分（15%）— 振幅超过均值越多越恐慌
    //    振幅比 2.5 → 100, 1.0 → 40, 0.5 → 0
    const ampScore = tech.amplitudeRatio != null
      ? Math.max(0, Math.min(100, (Math.min(tech.amplitudeRatio, 2.5) - 0.3) / 2.2 * 100))
      : 50;

    overall = Math.round(
      maScore * 0.25 + rsiScore * 0.20 + volScore * 0.20 + chg5dScore * 0.20 + ampScore * 0.15
    );

    // 保留旧字段兼容
    changeScore = Math.round(chg5dScore);
    amplitudeScore = Math.round(ampScore);
    turnoverScore = Math.round(volScore);
    rsi14Val = tech.rsi14 ?? undefined;
    ma20Val = tech.priceVsMa20Pct != null
      ? Math.round((changePercent / (tech.priceVsMa20Pct / 100 + 1) - changePercent / (tech.priceVsMa20Pct / 100 + 1)) * 100) / 100
      : undefined;
    priceVsMa20Val = tech.priceVsMa20Pct ?? undefined;
    volumeRatioVal = tech.volumeRatio ?? undefined;
    change5dVal = tech.change5dPct ?? undefined;
    amplitudeRatioVal = tech.amplitudeRatio ?? undefined;

  } else {
    // ── 降级方案（无历史数据）─ 使用原算法 ─────────────────
    // 1. 涨跌幅得分（35%）
    //   -5% → 100, 0% → 50, +5% → 0
    changeScore = Math.max(0, Math.min(100,
      50 - (changePercent * 10)
    ));

    // 2. 日内振幅得分（35%）
    //   振幅 5%+ → 100, 振幅 1% → 0
    let amplitude = 0;
    if (prevClose > 0 && high > 0 && low > 0) {
      amplitude = ((high - low) / prevClose) * 100;
    }
    amplitudeScore = Math.max(0, Math.min(100,
      (amplitude / 5) * 100
    ));

    // 3. 换手率得分（30%）
    //   换手 10%+ → 100, 换手 1% → 0
    turnoverScore = 50; // 默认中性
    if (turnoverRate != null && turnoverRate > 0) {
      turnoverScore = Math.max(0, Math.min(100,
        (turnoverRate / 10) * 100
      ));
    }

    overall = Math.round(
      changeScore * 0.35 + amplitudeScore * 0.35 + turnoverScore * 0.30
    );
  }

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
    // 新版技术指标（可选）
    rsi14: rsi14Val,
    ma20: ma20Val,
    priceVsMa20Pct: priceVsMa20Val,
    volumeRatio: volumeRatioVal,
    change5dPct: change5dVal,
    amplitudeRatio: amplitudeRatioVal,
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
