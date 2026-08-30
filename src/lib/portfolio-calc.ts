// ============================================================
// portfolio-calc.ts — 持仓计算唯一入口（共享模块）
// ------------------------------------------------------------
// 所有组件（PortfolioMiniCard / PortfolioSummary / PortfolioPanel /
// usePortfolio）统一使用本模块计算，保证口径一致：
//   1. 字段归一化：兼容 localStorage（stockCode/buyPrice/totalCost）
//      和同步 json（code/price/cost）两种格式，NaN 一律拦截
//   2. 盈亏口径：总盈亏 = 市值 + 已收分红 - 总投入（分红回补成本）
//   3. 港股自动 ×0.86 汇率换算成人民币
//   4. 成本股息率 = 年化每股分红(¥) / 每股真实成本(¥) × 100
// ============================================================

import type { DividendRecord, Position, PositionMetrics, StockData } from "@/lib/types";
import { getExchangeRate } from "@/lib/stockUtils";

// ─── 基础工具 ──────────────────────────────────────────────

/** 数字安全转换：非法值一律回落到 fallback，从根源拦截 NaN */
function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

// ─── 字段归一化 ────────────────────────────────────────────

export interface NormalizedPosition {
  id: string;
  stockCode: string;
  stockName: string;
  shares: number;
  buyPrice: number;      // 每股成本（原币种）
  totalCost: number;     // 总投入（原币种）
  buyDate?: string;
  dividends: DividendRecord[];
}

/**
 * 归一化持仓：兼容两种字段名格式，坏数据（无代码/0股）返回 null
 * - localStorage 标准格式：stockCode / buyPrice / totalCost
 * - 银河同步 json 格式：code / price / cost（cost 为每股成本）
 */
export function normalizePosition(
  raw: Partial<Position> & Record<string, unknown>,
  fallbackId?: string
): NormalizedPosition | null {
  const stockCode = String(raw.stockCode ?? raw.code ?? "").trim();
  const shares = numOr(raw.shares, 0);
  if (!stockCode || shares <= 0) return null;

  const buyPrice = numOr(raw.buyPrice ?? raw.price, 0);
  // totalCost 优先（localStorage）；否则 cost×shares（json 的 cost 是每股成本）；最后 buyPrice×shares
  const totalCostDirect = numOr(raw.totalCost, 0);
  const totalCost =
    totalCostDirect > 0
      ? totalCostDirect
      : numOr(raw.cost, 0) > 0
        ? numOr(raw.cost, 0) * shares
        : buyPrice * shares;

  const dividends = Array.isArray(raw.dividends)
    ? (raw.dividends as DividendRecord[]).filter(
        (d) => !!d && Number.isFinite(numOr(d.total, NaN))
      )
    : [];

  return {
    id: String(raw.id ?? fallbackId ?? `${stockCode}_${shares}`),
    stockCode,
    stockName: String(raw.stockName ?? stockCode),
    shares,
    buyPrice: buyPrice > 0 ? buyPrice : totalCost / shares,
    totalCost,
    buyDate: typeof raw.buyDate === "string" ? raw.buyDate : undefined,
    dividends,
  };
}

/** 批量归一化（过滤坏数据） */
export function normalizePositions(list: unknown): NormalizedPosition[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw, i) => normalizePosition(raw as Record<string, unknown>, `pos_${i}`))
    .filter((p): p is NormalizedPosition => p !== null);
}

// ─── 单持仓指标 ────────────────────────────────────────────

export function calcPositionMetrics(
  pos: NormalizedPosition,
  stockData?: StockData
): PositionMetrics {
  const rate = getExchangeRate(pos.stockCode);
  const currentPrice = numOr(stockData?.quote?.currentPrice, pos.buyPrice);
  const dividendYield = stockData?.fundamentals?.dividendYield;

  const marketValue = pos.shares * currentPrice * rate;
  const totalDividends =
    pos.dividends.reduce((sum, d) => sum + numOr(d.total, 0), 0) * rate;
  const totalCostCny = pos.totalCost * rate;
  const realCost = totalCostCny - totalDividends;
  const totalProfit = marketValue + totalDividends - totalCostCny;

  // 成本股息率：年化每股分红(¥) / 每股真实成本(¥)
  let costYield = 0;
  if (dividendYield != null && dividendYield > 0 && realCost > 0 && pos.shares > 0) {
    const annualDps = (dividendYield / 100) * currentPrice * rate;
    costYield = (annualDps / (realCost / pos.shares)) * 100;
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    currentPrice: r2(currentPrice * rate),
    marketValue: r2(marketValue),
    totalProfit: r2(totalProfit),
    totalProfitPct:
      totalCostCny > 0 ? Math.round((totalProfit / totalCostCny) * 10000) / 100 : 0,
    totalDividends: r2(totalDividends),
    realCost: r2(realCost),
    realCostPerShare: pos.shares > 0 ? r2(realCost / pos.shares) : 0,
    costYield: r2(costYield),
  };
}

// ─── 组合汇总（含年化分红，全组合唯一口径） ─────────────────

export interface PortfolioSummaryCalc {
  totalInvested: number;        // 总投入(¥)
  totalMarketValue: number;     // 当前市值(¥)
  totalDividends: number;       // 累计已收分红(¥)
  totalProfit: number;          // 总盈亏 = 市值 + 分红 - 投入
  totalProfitPct: number;
  annualDividendIncome: number; // 年化分红(¥) = Σ 市值 × 股息率
  dividendYieldOnCost: number;  // 成本股息率(%) = 年化分红 / 总投入
  positionCount: number;
}

export function calcPortfolioSummary(
  positions: NormalizedPosition[],
  stockDataMap: Map<string, StockData>
): PortfolioSummaryCalc {
  let totalInvested = 0;
  let totalMarketValue = 0;
  let totalDividends = 0;
  let annualDividendIncome = 0;

  for (const pos of positions) {
    const stockData = stockDataMap.get(pos.stockCode);
    const m = calcPositionMetrics(pos, stockData);
    const rate = getExchangeRate(pos.stockCode);

    totalInvested += pos.totalCost * rate;
    totalMarketValue += m.marketValue;
    totalDividends += m.totalDividends;

    const dividendYield = stockData?.fundamentals?.dividendYield;
    if (dividendYield != null && dividendYield > 0) {
      annualDividendIncome += m.marketValue * (dividendYield / 100);
    }
  }

  const totalProfit = totalMarketValue + totalDividends - totalInvested;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    totalInvested: r2(totalInvested),
    totalMarketValue: r2(totalMarketValue),
    totalDividends: r2(totalDividends),
    totalProfit: r2(totalProfit),
    totalProfitPct:
      totalInvested > 0 ? Math.round((totalProfit / totalInvested) * 10000) / 100 : 0,
    annualDividendIncome: r2(annualDividendIncome),
    dividendYieldOnCost:
      totalInvested > 0
        ? Math.round((annualDividendIncome / totalInvested) * 10000) / 100
        : 0,
    positionCount: positions.length,
  };
}
