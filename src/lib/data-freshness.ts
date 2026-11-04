/**
 * data-freshness.ts — 数据新鲜度清单（页面"数据的更新时间"唯一口径）
 *
 * 为什么要有：这个项目的数据是多条链路各自刷新到 JSON 缓存的，
 * 页面看起来永远"有数"，但可能是几天前的。2026-11 就出过事：
 * 指数估值用的是 2024-06 的数据（akshare 默认结束日期写死），
 * 而缓存里的抓取时间每天在变，界面上完全看不出来。
 *
 * 约定：
 *   1. 每个数据源在这里登记「谁在什么时候更新它」（cadence）和「多久算过期」（maxAgeHours）
 *   2. 纯函数 assessFreshness / formatAge / nextRunLabel 全部可单测，不碰 fs
 *   3. 页面只展示这里登记过的东西，新增缓存必须同步登记，否则不会出现在"数据更新"卡片里
 */

export type Cadence = "intraday" | "daily" | "weekly" | "monthly" | "ondemand";

export interface DataSourceSpec {
  /** 唯一 key，前端/日志用 */
  key: string;
  /** 展示名 */
  label: string;
  /** 相对仓库根的路径 */
  path: string;
  /** 更新频率 */
  cadence: Cadence;
  /** 谁在刷新它（展示给用户，说明"这是定时更新的"） */
  refresher: string;
  /** 超过多少小时算过期（late：超过 1.2 倍；stale：超过 2 倍） */
  maxAgeHours: number;
  /** 备注：口径/兜底说明 */
  note?: string;
}

export type FreshnessStatus = "ok" | "late" | "stale" | "missing";

/** 数据源清单（与 systemd 定时器保持一致，改定时器记得改这里） */
export const DATA_SOURCES: DataSourceSpec[] = [
  {
    key: "index_valuations",
    label: "指数估值分位（市场温度表）",
    path: "cache/index_valuations.json",
    cadence: "daily",
    refresher: "每日 15:05 日报任务（fetch_index_valuations.py）",
    maxAgeHours: 36,
    note: "中证指数（深证指数走乐咕）；缓存内 data_date 为数据最后交易日",
  },
  {
    key: "fx_rate",
    label: "港币汇率",
    path: "cache/fx_rate.json",
    cadence: "daily",
    refresher: "每日 15:05 日报任务（fetch_fx_rate.py）",
    maxAgeHours: 72,
    note: "抓不到时前端沿用兜底汇率 0.86，会影响港股市值与盈亏换算",
  },
  {
    key: "valuation_cache",
    label: "个股估值分位",
    path: "data/valuation_cache.json",
    cadence: "daily",
    refresher: "每日 15:05 日报任务（valuation_data.py）",
    maxAgeHours: 36,
  },
  {
    key: "financials",
    label: "财务指标（ROE/负债率/现金流）",
    path: "data/financials_cache.json",
    cadence: "daily",
    refresher: "每日 15:05 财报季更新（financials_data.py）",
    maxAgeHours: 24 * 40,
    note: "季报期间才有新数据，40 天内不更新属正常",
  },
  {
    key: "dividend",
    label: "股息率（现价/成本）",
    path: "data/dividend_yields.json",
    cadence: "weekly",
    refresher: "每周一 08:10 低频刷新（dividend_data.py）",
    maxAgeHours: 24 * 9,
  },
  {
    key: "moat",
    label: "护城河量化评分",
    path: "data/moat_cache.json",
    cadence: "monthly",
    refresher: "每周一 08:10 + 每月 1 日 08:20（moat_data.py）",
    maxAgeHours: 24 * 40,
  },
  {
    key: "moat_llm",
    label: "护城河文字描述",
    path: "data/moat_llm_cache.json",
    cadence: "monthly",
    refresher: "每月 1 日 08:20（moat_narrative.py，只补增量）",
    maxAgeHours: 24 * 100,
  },
  {
    key: "fear_tech",
    label: "恐慌指数/技术指标",
    path: "data/fear_tech_cache.json",
    cadence: "weekly",
    refresher: "每周一 08:10 低频刷新（fear_tech_data.py）",
    maxAgeHours: 24 * 9,
  },
  {
    key: "shareholder",
    label: "股东户数",
    path: "data/shareholder_cache.json",
    cadence: "monthly",
    refresher: "每周一 08:10 低频刷新（shareholder_data.py）",
    maxAgeHours: 24 * 40,
    note: "季报披露后才有变化",
  },
  {
    key: "industry",
    label: "行业分类（持仓行业暴露）",
    path: "data/industry_cache.json",
    cadence: "monthly",
    refresher: "每月 1 日 08:20（industry_data.py --refresh）",
    maxAgeHours: 24 * 100,
    note: "内置代码→行业兜底表，网络失败也不影响已有分类",
  },
  {
    key: "buyback_hk",
    label: "港股回购比例",
    path: "data/buyback_hk_cache.json",
    cadence: "weekly",
    refresher: "每周一 08:10 低频刷新（dividend_data.py）",
    maxAgeHours: 24 * 9,
  },
  {
    key: "bond",
    label: "国债收益率/逆回购",
    path: "data/bond_cache.json",
    cadence: "daily",
    refresher: "每日 15:05 + 打开页面时按需（bond_data.py，缓存 6 小时）",
    maxAgeHours: 48,
  },
  {
    key: "volatility",
    label: "波动率（网格步长）",
    path: "data/volatility_cache.json",
    cadence: "daily",
    refresher: "每日 15:05 日报任务（fetch_volatility.py）",
    maxAgeHours: 96,
  },
  {
    key: "advice",
    label: "操作建议",
    path: "data/advice_cache.json",
    cadence: "intraday",
    refresher: "页面/日报请求时按需重算（5 分钟缓存）",
    maxAgeHours: 24,
  },
  {
    key: "portfolio",
    label: "持仓与成本（手动录入）",
    path: "data/portfolio.json",
    cadence: "ondemand",
    refresher: "你在持仓页手动同步，系统不覆盖",
    maxAgeHours: 24 * 30,
  },
  {
    key: "cash",
    label: "可用现金（手动录入）",
    path: "data/cash.json",
    cadence: "ondemand",
    refresher: "你在「现金与仓位」卡片手动录入",
    maxAgeHours: 24 * 30,
  },
];

/**
 * 判定新鲜度。
 * ok：在预期周期内；late：超过 1.2 倍；stale：超过 2 倍；missing：文件不存在
 */
export function assessFreshness(
  ageHours: number | null,
  maxAgeHours: number,
): FreshnessStatus {
  if (ageHours == null || !Number.isFinite(ageHours)) return "missing";
  if (ageHours < 0) return "ok"; // 时钟偏差，别误报
  if (ageHours > maxAgeHours * 2) return "stale";
  if (ageHours > maxAgeHours * 1.2) return "late";
  return "ok";
}

/** 人类可读的"距今多久" */
export function formatAge(ageHours: number | null): string {
  if (ageHours == null || !Number.isFinite(ageHours)) return "无数据";
  if (ageHours < 1 / 60) return "刚刚";
  if (ageHours < 1) return `${Math.round(ageHours * 60)} 分钟前`;
  if (ageHours < 48) return `${Math.round(ageHours)} 小时前`;
  const days = Math.floor(ageHours / 24);
  if (days < 60) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

/** 更新频率的中文标签 */
export function cadenceLabel(c: Cadence): string {
  switch (c) {
    case "intraday":
      return "实时/按需";
    case "daily":
      return "每日定时";
    case "weekly":
      return "每周定时";
    case "monthly":
      return "每月定时";
    case "ondemand":
      return "手动录入";
  }
}

export interface FreshnessRow extends DataSourceSpec {
  updatedAt: string | null;
  ageHours: number | null;
  status: FreshnessStatus;
  /** 数据内部的真实数据日期（如指数估值的 data_date），比文件 mtime 更准 */
  dataDate?: string | null;
}

/** 汇总：有多少项过期 / 缺失，用于卡片头部一句话 */
export function summarize(rows: FreshnessRow[]): {
  total: number;
  ok: number;
  late: number;
  stale: number;
  missing: number;
  headline: string;
} {
  const ok = rows.filter((r) => r.status === "ok").length;
  const late = rows.filter((r) => r.status === "late").length;
  const stale = rows.filter((r) => r.status === "stale").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const bad = late + stale + missing;
  const headline =
    bad === 0
      ? `全部 ${rows.length} 项数据均在刷新周期内`
      : `${bad} 项需要关注（过期 ${stale} / 偏旧 ${late} / 缺失 ${missing}）`;
  return { total: rows.length, ok, late, stale, missing, headline };
}
