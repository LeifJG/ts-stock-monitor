// ============================================================
// types.ts — 共享类型定义（所有模块依赖此文件）
// ============================================================
// 本文件定义项目中所有核心数据类型，包括行情、基本面、告警规则等。
// 所有其他模块都依赖本文件中的类型，修改时请注意兼容性。

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

/** 指数行情（上证/创业板等） */
export interface IndexQuote {
  code: StockCode;
  name: string;
  currentPrice: number;
  changePercent: number;
  changeAmount: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

/** 基本面指标 */
export interface StockFundamentals {
  pe: number | null;            // 市盈率（动态）
  pb: number | null;            // 市净率
  marketCap: number | null;     // 总市值
  dividendYield: number | null; // 股息率 (%)
  turnoverRate: number | null;  // 换手率 (%)
  eps: number | null;           // 每股收益
  bvps: number | null;          // 每股净资产
}

/** 高管增减持记录 */
export interface InsiderTrade {
  date: string;          // 变动日期
  name: string;          // 高管姓名
  position: string;      // 职务
  changeType: "增持" | "减持" | "未知";
  volume: number;        // 变动数量（股）
  price: number;         // 变动均价
  ratio: number;         // 占流通股比例 (%)
}

/** 安全边际评分 */
export interface SafetyScore {
  grahamNumber: number | null;   // 格雷厄姆估值（元）
  marginOfSafety: number | null; // 安全边际百分比 (%)
  score: number | null;          // 评分 0-100
  grade: SafetyGrade;            // 等级
}

export type SafetyGrade = "优秀" | "良好" | "一般" | "危险" | "未知";

/** 单只股票的恐慌指数 0-100（0=极度贪婪，100=极度恐慌） */
export interface FearGauge {
  overall: number;              // 综合恐慌指数
  drawdown: number;             // 涨跌幅贡献分
  rsi: number;                  // 振幅贡献分
  macd: number;                 // 换手率贡献分
  label: string;                // 中文标签
}

/** 单只股票的完整数据 */
export interface StockData {
  quote: StockQuote;
  fundamentals: StockFundamentals;
  safetyScore?: SafetyScore;    // 安全边际评分
  fearGauge?: FearGauge;       // 恐慌指数
  insiderTrades?: InsiderTrade[]; // 高管增减持
}

/** 指数完整数据 */
export interface IndexData {
  quote: IndexQuote;
  fearGauge: FearGauge;
}

/** 排序字段 */
export type SortField =
  | "code"
  | "name"
  | "currentPrice"
  | "changePercent"
  | "pe"
  | "pb"
  | "marketCap"
  | "dividendYield"
  | "turnoverRate"
  | "fearIndex"
  | "safetyScore";

export type SortOrder = "asc" | "desc";

/** API 返回格式 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
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
  | "dividendYield"
  | "turnoverRate"
  | "fearIndex"
  | "volume";

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

/** 视图模式 */
export type ViewMode = "card" | "table";
