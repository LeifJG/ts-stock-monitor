// ============================================================
// tests/portfolio-calc.test.ts — 持仓计算核心口径测试（P1-4）
// 锁死三类历史 bug：NaN 拦截 / 港股汇率 / 盈亏口径（分红回补）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  normalizePosition,
  normalizePositions,
  calcPositionMetrics,
  calcPortfolioSummary,
  type NormalizedPosition,
} from "@/lib/portfolio-calc";
import { setHkdRate } from "@/lib/stockUtils";
import type { StockData } from "@/lib/types";

// ─── 测试数据工厂 ──────────────────────────────────────────

function stockData(price: number, dividendYield?: number): StockData {
  return {
    quote: {
      code: "000333",
      name: "美的集团",
      currentPrice: price,
      changePercent: 0,
    },
    fundamentals: dividendYield != null ? { dividendYield } : undefined,
  } as unknown as StockData;
}

function hkStockData(price: number): StockData {
  return {
    quote: { code: "01810", name: "小米集团-W", currentPrice: price, changePercent: 0 },
  } as unknown as StockData;
}

// ─── 归一化 ────────────────────────────────────────────────

describe("normalizePosition 字段归一化", () => {
  it("localStorage 格式：stockCode/buyPrice/totalCost", () => {
    const p = normalizePosition({
      stockCode: "000333",
      buyPrice: 80,
      totalCost: 8000,
      shares: 100,
    });
    expect(p).not.toBeNull();
    expect(p!.stockCode).toBe("000333");
    expect(p!.buyPrice).toBe(80);
    expect(p!.totalCost).toBe(8000);
  });

  it("银河同步格式：code/shares/cost（cost=每股成本 → totalCost=cost×shares）", () => {
    const p = normalizePosition({ code: "01810", shares: 4400, cost: 38.497 });
    expect(p).not.toBeNull();
    expect(p!.stockCode).toBe("01810");
    expect(p!.totalCost).toBeCloseTo(38.497 * 4400, 6);
    expect(p!.totalCost).toBeCloseTo(169386.8, 4);
  });

  it("坏数据拦截：无代码 / 0股 / NaN 股数 → null", () => {
    expect(normalizePosition({ shares: 100, cost: 10 })).toBeNull();
    expect(normalizePosition({ code: "000333", shares: 0, cost: 10 })).toBeNull();
    expect(normalizePosition({ code: "000333", shares: NaN, cost: 10 })).toBeNull();
  });

  it("NaN 成本不污染：cost 为 NaN 时回落 buyPrice×shares", () => {
    const p = normalizePosition({ code: "000333", shares: 100, cost: NaN, buyPrice: 50 });
    expect(p).not.toBeNull();
    expect(p!.totalCost).toBe(5000);
  });

  it("批量归一化过滤坏数据并保留好数据", () => {
    const list = normalizePositions([
      { code: "000333", shares: 100, cost: 80 },
      { shares: 100, cost: 80 }, // 无代码 → 丢弃
      { code: "01810", shares: 4400, cost: 38.5 },
    ]);
    expect(list).toHaveLength(2);
  });
});

// ─── 单持仓指标 ────────────────────────────────────────────

describe("calcPositionMetrics", () => {
  it("A股：盈亏口径 = 市值 + 分红 − 总投入（分红回补成本）", () => {
    const pos = normalizePosition({
      stockCode: "000333",
      shares: 100,
      buyPrice: 80,
      totalCost: 8000,
      dividends: [{ id: "d1", date: "2026-06-12", perShare: 3, total: 300 }],
    })!;
    const m = calcPositionMetrics(pos, stockData(86.23));
    expect(m.marketValue).toBe(8623);
    expect(m.totalDividends).toBe(300);
    expect(m.totalProfit).toBe(8623 + 300 - 8000); // 923
  });

  it("港股：市值/成本/分红全部按汇率换算成人民币", () => {
    setHkdRate(0.865);
    const pos = normalizePosition({
      code: "01810",
      shares: 4400,
      cost: 38.497,
      dividends: [{ id: "d1", date: "2026-06-12", perShare: 0.1, total: 440 }],
    })!;
    const m = calcPositionMetrics(pos, hkStockData(27.82));
    // 市值 = 4400 × 27.82 × 0.865
    expect(m.marketValue).toBeCloseTo(4400 * 27.82 * 0.865, 1);
    // 投入 = 38.497×4400×0.865
    const invested = 38.497 * 4400 * 0.865;
    expect(m.totalProfit).toBeCloseTo(
      4400 * 27.82 * 0.865 + 440 * 0.865 - invested,
      1
    );
  });

  it("行情缺失时回落成本价，绝不产生 NaN", () => {
    const pos = normalizePosition({ code: "000333", shares: 100, cost: 80 })!;
    const m = calcPositionMetrics(pos, undefined);
    expect(Number.isNaN(m.marketValue)).toBe(false);
    expect(m.currentPrice).toBe(80); // 回落 buyPrice=cost
    expect(m.marketValue).toBe(8000);
  });

  it("无分红数据（dividends 缺失）不报错、累计为 0", () => {
    const pos = normalizePosition({ code: "000333", shares: 100, cost: 80 })!;
    expect(pos!.dividends).toEqual([]);
    const m = calcPositionMetrics(pos, stockData(86.23));
    expect(m.totalDividends).toBe(0);
  });

  it("成本股息率 = 年化每股分红(¥) / 每股真实成本(¥)", () => {
    const pos = normalizePosition({
      stockCode: "000333",
      shares: 100,
      buyPrice: 80,
      totalCost: 8000,
      dividends: [{ id: "d1", date: "2026-06-12", perShare: 3, total: 300 }],
    })!;
    // 股息率 3.5% × 现价 86.23 → 年化每股 3.018；真实成本每股 (8000-300)/100=77
    const m = calcPositionMetrics(pos, stockData(86.23, 3.5));
    const expected = ((0.035 * 86.23) / 77) * 100;
    expect(m.costYield).toBeCloseTo(expected, 1);
  });
});

// ─── 组合汇总 ──────────────────────────────────────────────

describe("calcPortfolioSummary", () => {
  it("多持仓聚合（A股+港股混合），总盈亏 = 市值 + 分红 − 投入", () => {
    setHkdRate(0.865);
    const positions = normalizePositions([
      { code: "000333", shares: 100, cost: 80 }, // 投入 8000，现价 86.23
      { code: "01810", shares: 4400, cost: 38.5 }, // 投入 38.5×4400×0.865
    ]) as NormalizedPosition[];
    const map = new Map<string, StockData>([
      ["000333", stockData(86.23)],
      ["01810", hkStockData(27.82)],
    ]);
    const s = calcPortfolioSummary(positions, map);

    const invested = 8000 + 38.5 * 4400 * 0.865;
    const mv = 100 * 86.23 + 4400 * 27.82 * 0.865;
    expect(s.positionCount).toBe(2);
    expect(s.totalInvested).toBeCloseTo(invested, 1);
    expect(s.totalMarketValue).toBeCloseTo(mv, 1);
    expect(s.totalProfit).toBeCloseTo(mv - invested, 1);
    expect(s.totalProfitPct).toBeCloseTo(((mv - invested) / invested) * 100, 1);
  });

  it("年化分红与成本股息率：annualDividendIncome = Σ 市值×股息率", () => {
    const positions = normalizePositions([
      { code: "000333", shares: 100, cost: 80 },
    ])!;
    const map = new Map<string, StockData>([["000333", stockData(86.23, 3.5)]]);
    const s = calcPortfolioSummary(positions, map);
    expect(s.annualDividendIncome).toBeCloseTo(8623 * 0.035, 1);
    expect(s.dividendYieldOnCost).toBeCloseTo((8623 * 0.035 / 8000) * 100, 1);
  });
});
