// ============================================================
// safety-labels.ts — 日报「安全边际」文案（纯函数，可单测）
// ------------------------------------------------------------
// 历史问题：日报这段曾用「现价到首档网格补仓位的距离」当安全边际，
// 波动小的股票网格步长小 → 永远显示「下行空间仅 2%（风险较高）」，
// 把「波动小」说成了「风险高」，与估值毫无关系，且与同一份报告里的
// 「合理估值/现价溢价」行自相矛盾。
//
// 现在拆成两个独立、语义正确的标签：
//   1. 估值安全边际 = (合理估值 - 现价) / 合理估值，来自 advice.fairValuePremiumPct
//   2. 网格距离 = 现价到首档补仓价的百分比，纯中性信息，不做风险判断
// ============================================================

/** 估值安全边际标签（基于现价相对合理估值的溢价/折价 %） */
export function valuationMarginLabel(premiumPct: number | null | undefined): string {
  if (premiumPct == null || !Number.isFinite(premiumPct)) return "";
  const p = Math.round(premiumPct);
  const abs = Math.abs(p);
  if (p <= -20) return `🔵 估值折价 ${abs}%（安全边际厚）`;
  if (p < -5) return `🟢 估值折价 ${abs}%（有安全边际）`;
  if (p <= 5) {
    if (p === 0) return "🟡 估值合理";
    return `🟡 估值合理（${p > 0 ? "溢价" : "折价"} ${abs}%）`;
  }
  if (p <= 15) return `🟠 估值溢价 ${p}%（已高于合理估值）`;
  return `🔴 估值溢价 ${p}%（估值透支）`;
}

/** 距首档网格补仓价的距离（中性信息，不评价风险高低） */
export function gridDistanceLabel(dropPct: number | null | undefined): string {
  if (dropPct == null || !Number.isFinite(dropPct)) return "";
  return `距首档补仓 ${Math.round(dropPct)}%`;
}
