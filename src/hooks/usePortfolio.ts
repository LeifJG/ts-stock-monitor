// ============================================================
// usePortfolio.ts — 持仓管理 hook（localStorage 持久化）
// ============================================================

"use client";

import { useState, useCallback, useMemo } from "react";
import type { Position, DividendRecord, PositionMetrics, StockData } from "@/lib/types";
import { getExchangeRate, HKD_TO_CNY } from "@/lib/stockUtils";

const STORAGE_KEY = "ts-stock-monitor:portfolio";

// ─── 工具函数 ─────────────────────────────────────────────────

function loadPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePositions(positions: Position[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // 静默失败
  }
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Hook ─────────────────────────────────────────────────────

export function usePortfolio(stockDataMap: Map<string, StockData>) {
  const [positions, setPositions] = useState<Position[]>(loadPositions);

  const persist = useCallback((fn: (prev: Position[]) => Position[]) => {
    setPositions((prev) => {
      const next = fn(prev);
      savePositions(next);
      return next;
    });
  }, []);

  // ── CRUD ──────────────────────────────────────────────

  const addPosition = useCallback(
    (p: Omit<Position, "id" | "dividends">) => {
      persist((prev) => [
        ...prev,
        { ...p, id: genId(), dividends: [] },
      ]);
    },
    [persist]
  );

  const removePosition = useCallback(
    (id: string) => {
      persist((prev) => prev.filter((p) => p.id !== id));
    },
    []
  );

  const updatePosition = useCallback(
    (id: string, partial: Partial<Pick<Position, "shares" | "buyPrice" | "totalCost" | "stockName">>) => {
      persist((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...partial } : p))
      );
    },
    [persist]
  );

  // ── 分红 ───────────────────────────────────────────────

  const addDividend = useCallback(
    (positionId: string, d: Omit<DividendRecord, "id">) => {
      persist((prev) =>
        prev.map((p) =>
          p.id === positionId
            ? { ...p, dividends: [...p.dividends, { ...d, id: genId() }] }
            : p
        )
      );
    },
    [persist]
  );

  const removeDividend = useCallback(
    (positionId: string, dividendId: string) => {
      persist((prev) =>
        prev.map((p) =>
          p.id === positionId
            ? { ...p, dividends: p.dividends.filter((d) => d.id !== dividendId) }
            : p
        )
      );
    },
    [persist]
  );

  // ── 计算指标 ──────────────────────────────────────────

  const metrics = useMemo(() => {
    const m = new Map<string, PositionMetrics>();

    for (const pos of positions) {
      // 兼容两种字段名格式
      const stockCode = pos.stockCode || pos.code;
      const totalCost = pos.totalCost || pos.cost;
      const buyPrice = pos.buyPrice || pos.price;
      const posId = pos.id || `${stockCode}_${pos.shares}`;
      
      const stockData = stockDataMap.get(stockCode);
      const currentPrice = stockData?.quote.currentPrice ?? buyPrice;
      const dividendYield = stockData?.fundamentals.dividendYield;

      // 使用统一的汇率工具函数
      const exchangeRate = getExchangeRate(stockCode);

      // 所有金额都转换成人民币
      const marketValue = pos.shares * currentPrice * exchangeRate;
      const totalDividends = (pos.dividends || []).reduce((sum, d) => sum + d.total, 0) * exchangeRate;
      const totalCostCny = totalCost * exchangeRate;
      const realCost = totalCostCny - totalDividends;
      const totalProfit = marketValue + totalDividends - totalCostCny;

      // 成本股息率：最新年化每股分红 / 每股真实成本
      let costYield = 0;
      if (dividendYield != null && dividendYield > 0 && realCost > 0) {
        const annualDps = (dividendYield / 100) * currentPrice * exchangeRate;
        const realCostPerShare = realCost / pos.shares;
        costYield = (annualDps / realCostPerShare) * 100;
      }

      m.set(posId, {
        currentPrice: currentPrice * exchangeRate,
        marketValue: Math.round(marketValue * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
        totalProfitPct:
          totalCostCny > 0
            ? Math.round((totalProfit / totalCostCny) * 10000) / 100
            : 0,
        totalDividends: Math.round(totalDividends * 100) / 100,
        realCost: Math.round(realCost * 100) / 100,
        realCostPerShare:
          pos.shares > 0
            ? Math.round((realCost / pos.shares) * 100) / 100
            : 0,
        costYield: Math.round(costYield * 100) / 100,
      });
    }

    return m;
  }, [positions, stockDataMap]);

  // ── 汇总 ──────────────────────────────────────────────

  const summary = useMemo(() => {
    let totalInvested = 0;
    let totalMarketValue = 0;
    let totalDividends = 0;

    for (const pos of positions) {
      const posId = pos.id || `${pos.stockCode || pos.code}_${pos.shares}`;
      const m = metrics.get(posId);
      // 兼容两种字段名格式
      const totalCost = pos.totalCost || pos.cost;
      const stockCode = pos.stockCode || pos.code;
      
      // 港股的投入成本也需要转换成人民币
      const exchangeRate = getExchangeRate(stockCode);
      totalInvested += totalCost * exchangeRate;
      if (m) {
        totalMarketValue += m.marketValue;
        totalDividends += m.totalDividends;
      }
    }

    const totalProfit = totalMarketValue + totalDividends - totalInvested;
    return {
      totalInvested: Math.round(totalInvested * 100) / 100,
      totalMarketValue: Math.round(totalMarketValue * 100) / 100,
      totalDividends: Math.round(totalDividends * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      totalProfitPct:
        totalInvested > 0
          ? Math.round((totalProfit / totalInvested) * 10000) / 100
          : 0,
      positionCount: positions.length,
    };
  }, [positions, metrics]);

  return {
    positions,
    metrics,
    summary,
    addPosition,
    removePosition,
    updatePosition,
    addDividend,
    removeDividend,
  };
}
