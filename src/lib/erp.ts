// ============================================================
// src/lib/erp.ts — 股债性价比（ERP）与债券位置判定（纯函数，可单测）
// ------------------------------------------------------------
// 背景：格雷厄姆「股跌债涨」成立的前提是利率还有下行空间。
// 光看收益率数字判断不了「债券贵不贵」，必须看它在历史分布里的位置：
//   收益率分位越低 → 债券越贵 → 下行空间（利率下行→债涨）越有限
//   同时把股票的「盈利收益率」与 10 年国债对比，算股债差（ERP）
// ============================================================

/** 盈利收益率（%）= 1/PE×100；PE 非法返回 null */
export function earningsYield(pe: number | null | undefined): number | null {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return null;
  // 保留两位：避免 API 返回 13.280212483399733% 这种长小数
  return Math.round((100 / pe) * 100) / 100;
}

/** 股债性价比 ERP（百分点）= 盈利收益率 − 10 年国债收益率 */
export function erp(pe: number | null | undefined, bond10y: number | null | undefined): number | null {
  const ey = earningsYield(pe);
  if (ey == null || bond10y == null || !Number.isFinite(bond10y)) return null;
  return Math.round((ey - bond10y) * 100) / 100;
}

export interface Verdict {
  level: "good" | "neutral" | "bad";
  label: string;
}

/**
 * 债券位置判定：按 10 年国债收益率的历史分位
 * 分位低 = 收益率在历史低位 = 债券贵、继续下行的空间小（不适合当下买入长债）
 */
export function bondPositionVerdict(pct: number | null | undefined): Verdict {
  if (pct == null || !Number.isFinite(pct)) return { level: "neutral", label: "数据不足" };
  if (pct <= 20) return { level: "bad", label: "债贵·利率已近历史低位" };
  if (pct <= 40) return { level: "neutral", label: "偏贵" };
  if (pct <= 70) return { level: "neutral", label: "中性" };
  if (pct <= 90) return { level: "good", label: "偏便宜" };
  return { level: "good", label: "利率高位·债券便宜" };
}

/** 股债性价比判定：ERP 越大，股票相对债券越有吸引力 */
export function erpVerdict(value: number | null | undefined): Verdict {
  if (value == null || !Number.isFinite(value)) return { level: "neutral", label: "数据不足" };
  if (value >= 8) return { level: "good", label: "股票显著便宜" };
  if (value >= 5) return { level: "good", label: "股票占优" };
  if (value >= 2) return { level: "neutral", label: "股债均衡" };
  if (value >= 0) return { level: "neutral", label: "债略占优" };
  return { level: "bad", label: "债券占优" };
}

/**
 * 久期给出的利率敏感度：利率上行 1% 时债券 ETF 的近似价格变动（%）
 * 用久期近似（不含凸性），用于提示长债的「不是防守」属性
 */
export function priceImpactIfRateUp1Pct(duration: number | null | undefined): number | null {
  if (duration == null || !Number.isFinite(duration)) return null;
  return Math.round(-duration * 10) / 10;
}
