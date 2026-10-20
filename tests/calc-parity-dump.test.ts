// ============================================================
// tests/calc-parity-dump.test.ts — 生成 TS 侧计算基准
// ------------------------------------------------------------
// 作用：把 portfolio-calc.ts 在固定夹具上的计算结果导出成 JSON，
//      供 Python 移植版逐字段比对（scripts/calc_parity.py）。
// 为什么这么做：移植最怕「看起来一样、算出来差 0.01」。
//      用同一份输入跑两套实现、机器比对，比人眼核对可靠得多。
// 跑法：pnpm exec vitest run tests/calc-parity-dump.test.ts
// ============================================================

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  normalizePositions,
  calcPositionMetrics,
  calcPortfolioSummary,
} from "@/lib/portfolio-calc";
import { setHkdRate } from "@/lib/stockUtils";

const FIXTURE = path.resolve(__dirname, "fixtures/calc_cases.json");
const OUT = path.resolve(__dirname, "fixtures/ts_calc_output.json");

interface StockDataLike {
  quote?: { currentPrice?: number };
  fundamentals?: { dividendYield?: number };
}

describe("导出 TS 侧持仓计算基准", () => {
  it("逐 case 计算并落盘", () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    expect(setHkdRate(fixture.fxRate)).toBe(true);

    const results = fixture.cases.map((c: any) => {
      const positions = normalizePositions(c.positions);
      const map = new Map<string, any>(Object.entries(c.stockData ?? {}));
      const perPosition = positions.map((p) => ({
        // 归一化后的持仓字段（Python 归一化结果要和这个完全一致）
        normalized: {
          id: p.id,
          stockCode: p.stockCode,
          stockName: p.stockName,
          shares: p.shares,
          buyPrice: p.buyPrice,
          totalCost: p.totalCost,
          baseShares: p.baseShares,
          ...(p.lastAddPrice !== undefined ? { lastAddPrice: p.lastAddPrice } : {}),
        },
        metrics: calcPositionMetrics(p, map.get(p.stockCode) as StockDataLike as any),
      }))
      return {
        name: c.name,
        // 被过滤掉的坏数据条数（0 股 / 无代码）
        droppedByNormalize: c.positions.length - positions.length,
        perPosition,
        summary: calcPortfolioSummary(positions, map as any),
      };
    });

    fs.writeFileSync(OUT, JSON.stringify({ fxRate: fixture.fxRate, results }, null, 2) + "\n");
    expect(results.length).toBe(fixture.cases.length);
  });

  it("导出真实持仓基准（data/portfolio.json + 真实汇率）", () => {
    const fxFile = path.resolve(__dirname, "../cache/fx_rate.json");
    const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
    expect(setHkdRate(fx.rate)).toBe(true);

    const pfFile = path.resolve(__dirname, "../data/portfolio.json");
    const raw = JSON.parse(fs.readFileSync(pfFile, "utf8"));
    const positions = normalizePositions(raw);

    // 真实行情不在单测里拉取（会联网、不稳定）；这里用空行情走「回落买入价」路径，
    // 目的是验证真实持仓的归一化与汇总口径一致。
    const stockData: Record<string, any> = {};
    const map = new Map<string, any>(Object.entries(stockData));

    const payload = {
      fxRate: fx.rate,
      stockData,
      droppedByNormalize: raw.length - positions.length,
      perPosition: positions.map((p) => ({
        normalized: {
          id: p.id,
          stockCode: p.stockCode,
          shares: p.shares,
          buyPrice: p.buyPrice,
          totalCost: p.totalCost,
          baseShares: p.baseShares,
          ...(p.lastAddPrice !== undefined ? { lastAddPrice: p.lastAddPrice } : {}),
        },
        metrics: calcPositionMetrics(p, map.get(p.stockCode) as StockDataLike as any),
      })),
      summary: calcPortfolioSummary(positions, map as any),
    };

    fs.writeFileSync(
      path.resolve(__dirname, "fixtures/ts_calc_output_real.json"),
      JSON.stringify(payload, null, 2) + "\n"
    );
    expect(positions.length).toBeGreaterThan(0);
  });
});
