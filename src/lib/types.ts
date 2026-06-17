// ============================================================
// types.ts — 共享类型定义（所有模块依赖此文件）
// ============================================================
// 本文件定义项目中所有核心数据类型，包括行情、基本面、告警规则等。
// 所有其他模块都依赖本文件中的类型，修改时请注意兼容性。

/** A 股代码，如 "600519"、"000001" */
export type StockCode = string;

/** 市场标识 */
export type Exchange = "SH" | "SZ" | "BJ" | "HK";

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
  prevClose: number;
  changePercent: number;
  changeAmount: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  timestamp: number;
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
  roe: number | null;           // 净资产收益率 (%)
  dividendPayoutRatio: number | null; // 股息支付率 (%) = 每股股息 ÷ EPS
  debtRatio: number | null;     // 资产负债率 (%)
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

/** 分红记录 */
export interface DividendRecord {
  id: string;
  date: string;        // 到账日期
  perShare: number;    // 每股分红（元）
  total: number;       // 实际到账（元）
}

/** 持仓记录 */
export interface Position {
  id: string;
  stockCode: StockCode;
  stockName: string;        // 缓存名称
  shares: number;           // 持有股数
  buyPrice: number;         // 买入均价（元/股）
  totalCost: number;        // 总投入（含手续费）
  buyDate: string;          // 首次买入日期
  dividends: DividendRecord[];
}

/** 持仓计算指标 */
export interface PositionMetrics {
  currentPrice: number;      // 当前价
  marketValue: number;       // 当前市值
  totalProfit: number;       // 总盈亏
  totalProfitPct: number;    // 盈亏百分比
  totalDividends: number;    // 累计分红
  realCost: number;          // 真实成本 = 总投入 - 累计分红
  realCostPerShare: number;  // 每股真实成本
  costYield: number;         // 成本股息率(%) = 最新年化每股分红 / 每股真实成本 × 100
}

/** 安全边际评分 */
export interface SafetyScore {
  grahamNumber: number | null;   // 格雷厄姆估值（元）
  marginOfSafety: number | null; // 安全边际百分比 (%)
  score: number | null;          // 评分 0-100（保守）
  grade: SafetyGrade;            // 等级
  // ROE修正版: 对高PB白马股更友好
  roeAdjustedValue: number | null;  // ROE修正估值（元）
  roeMarginOfSafety: number | null; // 修正安全边际 (%)
  roeScore: number | null;          // 修正评分 0-100
  roeGrade: SafetyGrade;            // 修正等级
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
  | "safetyScore"
  | "roe"
  | "dividendPayoutRatio"
  | "debtRatio";

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
  | "volume"
  | "roe"
  | "dividendPayoutRatio"
  | "debtRatio";

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

/** 分红日历事件 */
export interface DividendCalendarEvent {
  date: string;            // 预计除权除息日 YYYY-MM-DD
  stockCode: StockCode;
  stockName: string;
  perShare: number;        // 预计每股分红
  confidence: "high" | "medium" | "low";  // 预测可信度
  type: "annual" | "interim" | "special"; // 年度/中期/特别分红
}

/** 行业分类数据 */
export interface IndustryData {
  stockCode: StockCode;
  stockName: string;
  industry: string;        // 所属行业
}

/** 组合收益汇总扩展 */
export interface PortfolioSummaryExtended {
  totalInvested: number;
  totalMarketValue: number;
  totalDividends: number;
  totalProfit: number;
  totalProfitPct: number;
  positionCount: number;
  annualDividendIncome: number;     // 年化分红收入（基于当前持仓）
  annualDividendYield: number;      // 年化分红收益率(市值)
  dividendYieldOnCost: number;      // 年化分红/总投入
  avgHoldingYears: number;          // 平均持仓年数
}

/** 视图模式 */
export type ViewMode = "card" | "table";
