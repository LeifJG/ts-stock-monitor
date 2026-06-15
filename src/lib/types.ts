// ============================================================
// types.ts — 共享类型定义（所有模块依赖此文件）
// ============================================================

/** A 股代码，如 "600519"、"000001" */
export type StockCode = string;

/** 市场标识 */
export type Exchange = "SH" | "SZ" | "BJ";

/** 股票基础信息 */
export interface StockMeta {
  code: StockCode;
  name: string;
  exchange: Exchange;
}

/** 实时行情数据 */
export interface StockQuote {
  code: StockCode;
  name: string;
  currentPrice: number;       // 当前价
  prevClose: number;          // 昨收
  changePercent: number;      // 涨跌幅 (%)
  changeAmount: number;       // 涨跌额
  high: number;               // 最高
  low: number;                // 最低
  volume: number;             // 成交量（手）
  amount: number;             // 成交额（元）
  timestamp: number;          // 数据时间戳
}

/** 基本面指标 */
export interface StockFundamentals {
  pe: number | null;            // 市盈率（动态）
  pb: number | null;            // 市净率
  marketCap: number | null;     // 总市值
  dividendYield: number | null; // 股息率 (%)
}

/** 单只股票的完整数据 */
export interface StockData {
  quote: StockQuote;
  fundamentals: StockFundamentals;
}

/** 告警规则的操作符 */
export type AlertOperator = ">" | ">=" | "<" | "<=" | "==";

/** 可设置告警的字段 */
export type AlertField =
  | "currentPrice"
  | "changePercent"
  | "pe"
  | "pb"
  | "marketCap"
  | "dividendYield";

/** 告警规则 */
export interface AlertRule {
  id: string;
  stockCode: StockCode;       // 空字符串 = 全局规则（适用于所有股票）
  field: AlertField;
  operator: AlertOperator;
  value: number;
  label: string;              // 用户可读描述，如"股息率 > 5%"
  enabled: boolean;
}

/** 告警触发结果 */
export interface AlertTrigger {
  ruleId: string;
  ruleLabel: string;
  stockCode: StockCode;
  stockName: string;
  field: AlertField;
  currentValue: number;
  threshold: number;
  operator: AlertOperator;
}

/** 用户配置 */
export interface UserConfig {
  watchlist: StockCode[];        // 自选股列表
  refreshInterval: number;       // 刷新间隔（秒）
  alertRules: AlertRule[];
}

/** API 返回格式 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
