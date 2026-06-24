// ============================================================
// format.ts — 共享格式化工具函数和调色板
// ============================================================

/** 数字格式化：保留 d 位小数，千分位 */
export const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--";

/** 金额格式化：¥ + fmt */
export const fmtMoney = (v: number | null | undefined): string =>
  v != null ? "¥" + fmt(v, 2) : "--";

/** 百分比格式化（带 +/-） */
export const fmtPct = (v: number | null | undefined): string =>
  v != null ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";

/** 简短金额（万级） */
export const fmtShortMoney = (v: number): string => {
  if (v >= 10000) return "¥" + (v / 10000).toFixed(1) + "万";
  return "¥" + v.toLocaleString("zh-CN");
};

/** 图表调色板（与 CSS 变量对应，暗色/浅色通用） */
export const CHART_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#6366f1",
];

/** 涨跌颜色函数：返回 CSS 变量名 */
export const priceColorFn = (changePct: number): string =>
  changePct > 0 ? "var(--red)" : changePct < 0 ? "var(--green)" : "var(--text-tertiary)";

/** 恐惧指数颜色函数 */
export const fearColor = (overall: number): { text: string; bg: string; bar: string } => {
  if (overall < 40) return { text: "#22c55e", bg: "rgba(34,197,94,0.15)", bar: "#22c55e" };
  if (overall < 60) return { text: "#eab308", bg: "rgba(234,179,8,0.15)", bar: "#eab308" };
  return { text: "#ef4444", bg: "rgba(239,68,68,0.15)", bar: "#ef4444" };
};
