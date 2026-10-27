// ============================================================
// src/lib/cash-plan.ts — 现金仓位分析与建议（纯函数，可单测）
// ------------------------------------------------------------
// 系统原来只认股票持仓，不知道手上有多少现金，导致「仓位」无法分析：
// 一个 100% 满仓跌 30% 的组合，和一个 60% 仓位跌 30% 的组合，
// 风险与可操作空间完全不同。
//
// 这里把「现金该留多少」做成可解释的规则，而不是拍一个数：
//   1. 保留区间由全市场估值分位决定（贵→多留，便宜→少留）
//   2. 格雷厄姆 25/75 约束兜底（现金不低于 5%、不高于 75%）
//   3. 现金用途按「缺口 / 适中 / 富余」三档给具体动作
// ============================================================

/** 现金占比（%）：现金 /（现金 + 股票市值） */
export function cashRatio(cash: number | null | undefined, stockValue: number | null | undefined): number | null {
  const c = Math.max(0, cash ?? 0);
  const s = Math.max(0, stockValue ?? 0);
  const total = c + s;
  if (total <= 0) return null;
  return Math.round((c / total) * 1000) / 10;
}

export interface CashBand {
  min: number;   // 建议下限（%）
  max: number;   // 建议上限（%）
  label: string; // 依据说明
}

/**
 * 建议现金占比区间（%）：市场越贵，现金留得越多。
 * marketPct = 代表指数（沪深300）的 PE 历史分位；erp 为股债差，仅用于说明。
 */
export function recommendedCashBand(marketPct: number | null | undefined): CashBand {
  const p = marketPct == null || !Number.isFinite(marketPct) ? null : marketPct;
  if (p == null) return { min: 15, max: 25, label: "缺少市场估值分位，按中性 15–25% 处理" };
  if (p >= 85) return { min: 30, max: 45, label: `市场估值分位 ${p}%（很贵）→ 现金 30–45%，留着等便宜` };
  if (p >= 70) return { min: 25, max: 35, label: `市场估值分位 ${p}%（偏贵）→ 现金 25–35%` };
  if (p >= 50) return { min: 18, max: 28, label: `市场估值分位 ${p}%（中性偏上）→ 现金 18–28%` };
  if (p >= 30) return { min: 12, max: 22, label: `市场估值分位 ${p}%（偏低）→ 现金 12–22%，可逐步投入` };
  return { min: 8, max: 15, label: `市场估值分位 ${p}%（便宜）→ 现金 8–15%，不必留太多` };
}

export type CashLevel = "short" | "ok" | "excess";

export interface CashPlan {
  level: CashLevel;
  ratioPct: number | null;
  band: CashBand;
  /** 回到区间内需要补充/多出的金额（元）；0 表示已在区间内 */
  gapToMin: number;
  excessAboveMax: number;
  headline: string;
  actions: string[];
}

/**
 * 现金仓位方案：给定现金、股票市值、市场估值分位，输出等级与具体动作。
 * parkingRate = 逆回购/货基年化（%），仅用于估算停泊收益。
 */
export function buildCashPlan(params: {
  cash: number;
  stockValue: number;
  marketPct: number | null | undefined;
  parkingRate?: number | null;
  /** 手上有安全边际、值得补仓的标的数量，用于微调措辞 */
  cheapHoldingCount?: number;
}): CashPlan {
  const { cash, stockValue, marketPct, parkingRate, cheapHoldingCount = 0 } = params;
  const ratio = cashRatio(cash, stockValue);
  const band = recommendedCashBand(marketPct);
  const total = Math.max(0, cash) + Math.max(0, stockValue);

  const bandMinAmt = (band.min / 100) * total;
  const bandMaxAmt = (band.max / 100) * total;
  const gapToMin = Math.max(0, Math.round(bandMinAmt - cash));
  const excessAboveMax = Math.max(0, Math.round(cash - bandMaxAmt));

  const parking = parkingRate != null && Number.isFinite(parkingRate) ? parkingRate : 1.4;
  const parkIncome = Math.round(((Math.max(0, cash) * parking) / 100) * 100) / 100;

  if (ratio == null) {
    return {
      level: "ok",
      ratioPct: null,
      band,
      gapToMin: 0,
      excessAboveMax: 0,
      headline: "还没有记录可用现金，先填一个数才能做仓位分析",
      actions: [`把证券账户里的可用资金填进来（当前停泊利率约 ${parking.toFixed(2)}%，${(cash || 0).toLocaleString("zh-CN")} 元一年约 ${parkIncome.toLocaleString("zh-CN")} 元）`],
    };
  }

  if (ratio < band.min) {
    const actions = [
      gapToMin > 0
        ? `补到建议下限需再有 ${gapToMin.toLocaleString("zh-CN")} 元现金：优先来自高估标的减仓，不要靠融资`
        : "现金略低于建议下限，注意别再一次性打满",
      cheapHoldingCount > 0
        ? `手上的折价标的有 ${cheapHoldingCount} 只，补仓按网格价分批，单次不超过现金的 1/3`
        : "当前没有明显折价标的，现金先停泊等机会",
      "现金不足时最危险的动作：为了补仓卖掉还在低估区的持仓（左右手互换，只交手续费）",
    ];
    return {
      level: "short", ratioPct: ratio, band, gapToMin, excessAboveMax,
      headline: `现金占比 ${ratio}%，低于建议下限 ${band.min}% → 弹药不足，下跌时只能干看着`,
      actions,
    };
  }

  if (ratio > band.max) {
    return {
      level: "excess", ratioPct: ratio, band, gapToMin, excessAboveMax,
      headline: `现金占比 ${ratio}%，高于建议上限 ${band.max}% → 有 ${excessAboveMax.toLocaleString("zh-CN")} 元闲钱没在干活`,
      actions: [
        `先让闲钱生息：国债逆回购（GC001/GC007）或场内货基，年化约 ${parking.toFixed(2)}%，一年约 ${parkIncome.toLocaleString("zh-CN")} 元`,
        "再按估值分位分批建仓：分位 <30% 的标的优先，一次不超过富余资金的 1/3",
        "富余不等于该马上买——贵的时候拿着现金本身就是一种仓位（机会成本换选择权）",
      ],
    };
  }

  return {
    level: "ok", ratioPct: ratio, band, gapToMin, excessAboveMax,
    headline: `现金占比 ${ratio}%，落在建议区间 ${band.min}–${band.max}% 内 → 仓位健康`,
    actions: [
      `闲钱停泊吃利息：逆回购/货基年化约 ${parking.toFixed(2)}%，一年约 ${parkIncome.toLocaleString("zh-CN")} 元`,
      cheapHoldingCount > 0
        ? `只对折价最深的那几只分批补（当前折价标的 ${cheapHoldingCount} 只），别把钱一次用完`
        : "等更好的价格，不追高",
      "每月复核一次市场分位：分位抬升超过 70% 时把现金上限往上调一档",
    ],
  };
}
