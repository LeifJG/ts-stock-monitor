// ============================================================
// constants.ts — 全局常量与默认配置
// ============================================================
// 包含默认自选股列表、刷新间隔、交易所映射以及告警字段的显示标签。

import type { StockCode, UserConfig } from "./types";

/** 默认自选股列表（用户可自行修改） */
export const DEFAULT_WATCHLIST: StockCode[] = [
  "600519", // 贵州茅台
  "000858", // 五粮液
  "600036", // 招商银行
  "601318", // 中国平安
  "000333", // 美的集团
];

/** 大盘指数代码 */
export const INDEX_CODES: StockCode[] = [
  "000001", // 上证指数
  "399006", // 创业板指
];

/** 默认刷新间隔（秒） */
export const DEFAULT_REFRESH_INTERVAL = 10;

/** 默认用户配置 */
export const DEFAULT_CONFIG: UserConfig = {
  watchlist: DEFAULT_WATCHLIST,
  refreshInterval: DEFAULT_REFRESH_INTERVAL,
  alertRules: [],
};

/** A 股代码 → 交易所前缀映射 */
export function getExchange(code: StockCode): string {
  if (code.startsWith("6")) return "sh";
  if (code.startsWith("0") || code.startsWith("3")) return "sz";
  if (code.startsWith("8") || code.startsWith("4")) return "bj";
  return "sh"; // fallback
}

/** 新浪 API 前缀 */
export function getSinaPrefix(code: StockCode): string {
  return getExchange(code);
}

/** 东方财富 secid: 1=SH, 0=SZ, 2=BJ */
export function getEastMoneySecId(code: StockCode): string {
  if (code.startsWith("6")) return `1.${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `0.${code}`;
  return `2.${code}`;
}

/** 告警字段 → 中文标签 */
export const FIELD_LABELS: Record<string, string> = {
  currentPrice: "最新价",
  changePercent: "涨跌幅",
  pe: "市盈率",
  pb: "市净率",
  marketCap: "总市值",
  dividendYield: "股息率",
  turnoverRate: "换手率",
  fearIndex: "恐慌指数",
  volume: "成交量",
};

/** 告警字段单位 */
export const FIELD_UNITS: Record<string, string> = {
  currentPrice: "元",
  changePercent: "%",
  pe: "倍",
  pb: "倍",
  marketCap: "亿",
  dividendYield: "%",
  turnoverRate: "%",
  fearIndex: "",
  volume: "手",
};

/** 排序字段 → 中文标签 */
export const SORT_LABELS: Record<string, string> = {
  code: "代码",
  name: "名称",
  currentPrice: "现价",
  changePercent: "涨跌幅",
  pe: "市盈率",
  pb: "市净率",
  marketCap: "总市值",
  dividendYield: "股息率",
  turnoverRate: "换手率",
  fearIndex: "恐慌指数",
  safetyScore: "安全评分",
};

/** 表格列宽（Tailwind 类） */
export const COL_WIDTHS: Record<string, string> = {
  code: "w-16",
  name: "w-24",
  changePercent: "w-20",
  currentPrice: "w-18",
  pe: "w-16",
  pb: "w-16",
  marketCap: "w-20",
  dividendYield: "w-16",
  turnoverRate: "w-16",
  eps: "w-18",
  fearIndex: "w-20",
  safetyScore: "w-20",
};
