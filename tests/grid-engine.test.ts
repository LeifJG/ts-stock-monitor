// ============================================================
// tests/grid-engine.test.ts — 网格引擎核心逻辑测试（P1-4）
// 锁死步长优先级：手动设置 > 真实历史波动率 > 中性默认 3%
// 以及 stockUtils 港股识别/汇率注入（P1-5）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  estimateVolatility,
  suggestGridStep,
  computeGridPlan,
  DEFAULT_GRID_SETTINGS,
} from "@/lib/grid-engine";
import { isHKStock, getExchangeRate, setHkdRate, getHkdRate } from "@/lib/stockUtils";
import type { Position, StockData } from "@/lib/types";

function mkPosition(partial: Partial<Position>): Position {
  return {
    stockCode: "000333",
    stockName: "美的集团",
    shares: 1000,
    buyPrice: 80,
    totalCost: 80000,
    ...partial,
  } as Position;
}

function mkStock(price: number): StockData {
  return {
    quote: { code: "000333", name: "美的集团", currentPrice: price, changePercent: 0 },
  } as unknown as StockData;
}

describe("estimateVolatility 波动率钳制", () => {
  it("偏离度小 → 下限 3%", () => {
    expect(estimateVolatility(80, 80)).toBe(3);
  });
  it("偏离度大 → 上限 25%", () => {
    expect(estimateVolatility(200, 80)).toBe(25);
  });
  it("正常区间 = |现价−成本|/成本 × 0.7 × 100", () => {
    // |86.23-80|/80 × 0.7 × 100 = 5.45
    expect(estimateVolatility(86.23, 80)).toBeCloseTo(5.45, 2);
  });
});

describe("suggestGridStep", () => {
  it("低波动率 → 下限 2%", () => {
    expect(suggestGridStep(1.0)).toBe(2);
  });
  it("正常波动率 → 0.5 倍保留一位小数", () => {
    expect(suggestGridStep(5.14)).toBe(2.6);
  });
});

describe("computeGridPlan 步长优先级（网格步长重构后的口径锁）", () => {
  it("优先级 1：手动设置 stepPct > 0 时最优先", () => {
    const plan = computeGridPlan(
      mkPosition({}),
      mkStock(86.23),
      { stepPct: 5.5 },
      2.5 // 历史波动率步长存在但应被手动值覆盖
    );
    expect(plan.stepPct).toBe(5.5);
  });

  it("优先级 2：无手动值时用真实历史波动率步长", () => {
    const plan = computeGridPlan(mkPosition({}), mkStock(86.23), {}, 2.5);
    expect(plan.stepPct).toBe(2.5);
  });

  it("优先级 3：都没有时回落中性默认 3%", () => {
    const plan = computeGridPlan(mkPosition({}), mkStock(86.23), {}, undefined);
    expect(plan.stepPct).toBe(3);
  });

  it("零历史步长视为无效，不使用", () => {
    const plan = computeGridPlan(mkPosition({}), mkStock(86.23), {}, 0);
    expect(plan.stepPct).toBe(3);
  });
});

describe("stockUtils 港股识别与汇率注入（P1-5）", () => {
  it("isHKStock：5位=港股，6位=A股", () => {
    expect(isHKStock("01810")).toBe(true);
    expect(isHKStock("00700")).toBe(true);
    expect(isHKStock("000333")).toBe(false);
    expect(isHKStock("600519")).toBe(false);
  });

  it("默认汇率 0.86，注入后 getExchangeRate 跟随", () => {
    setHkdRate(0.865);
    expect(getHkdRate()).toBe(0.865);
    expect(getExchangeRate("01810")).toBe(0.865);
    expect(getExchangeRate("000333")).toBe(1);
  });

  it("setHkdRate 拒绝区间外的脏数据", () => {
    expect(setHkdRate(0.5)).toBe(false);   // 过低
    expect(setHkdRate(1.2)).toBe(false);   // 过高
    expect(setHkdRate(NaN)).toBe(false);   // 非法
    expect(getHkdRate()).toBe(0.865);      // 未被污染
    setHkdRate(0.86); // 恢复默认，避免影响其他测试
  });
});
