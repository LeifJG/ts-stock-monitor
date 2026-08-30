// ============================================================
// usePortfolio.ts — 持仓管理 hook（localStorage 持久化）
// ------------------------------------------------------------
// 计算逻辑统一走 src/lib/portfolio-calc.ts（唯一口径）；
// 实时行情自动合并（含 watchlist 之外的港股，走共享缓存）。
// ============================================================

"use client";

import { useState, useCallback, useMemo } from "react";
import type { Position, DividendRecord, StockData } from "@/lib/types";
import {
  normalizePositions,
  calcPositionMetrics,
  calcPortfolioSummary,
} from "@/lib/portfolio-calc";
import { usePortfolioStocks } from "./usePortfolioStocks";

const STORAGE_KEY = "ts-stock-monitor:portfolio";

// ─── 持久化 ───────────────────────────────────────────────────

function loadPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // 读取即清洗：归一化字段 + 过滤坏数据（无代码/0股/无成本），并回写修复
    const cleaned = normalizePositions(JSON.parse(raw));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      // 回写失败不影响使用
    }
    return cleaned;
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

/**
 * @param externalMap 页面级行情（watchlist 内股票），可缺省——
 *                    持仓里不在 watchlist 的股票（港股等）会自动通过
 *                    usePortfolioStocks 拉取并合并
 */
export function usePortfolio(externalMap?: Map<string, StockData>) {
  const [positions, setPositions] = useState<Position[]>(loadPositions);

  const persist = useCallback((fn: (prev: Position[]) => Position[]) => {
    setPositions((prev) => {
      const next = fn(prev);
      savePositions(next);
      return next;
    });
  }, []);

  // ── 实时行情合并（共享缓存，多组件只发一次请求） ──────────
  const quoteCodes = useMemo(
    () =>
      positions
        .map((p) => (p.stockCode || p.code || "").toString())
        .filter((c) => c && !(externalMap?.has(c) && externalMap.get(c)?.quote?.currentPrice != null)),
    [positions, externalMap]
  );
  const quoteMap = usePortfolioStocks(quoteCodes);

  const stockDataMap = useMemo(() => {
    const merged = new Map<string, StockData>(externalMap ?? []);
    quoteMap.forEach((v, k) => merged.set(k, v));
    return merged;
  }, [externalMap, quoteMap]);

  // ── CRUD ──────────────────────────────────────────────

  const addPosition = useCallback(
    (p: Omit<Position, "id">) => {
      persist((prev) => [
        ...prev,
        { ...p, id: genId(), dividends: Array.isArray(p.dividends) ? p.dividends : [] },
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
            ? { ...p, dividends: [...(p.dividends || []), { ...d, id: genId() }] }
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
            ? { ...p, dividends: (p.dividends || []).filter((d) => d.id !== dividendId) }
            : p
        )
      );
    },
    [persist]
  );

  // ── 计算指标（统一走 portfolio-calc，唯一口径） ──────────

  // normalized：字段必填（stockCode/totalCost/buyPrice/dividends），
  // 下游组件（表格/环形图/卡片）一律使用它，天然免疫格式差异和坏数据
  const normalized = useMemo(() => normalizePositions(positions), [positions]);

  const metrics = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcPositionMetrics>>();
    for (const pos of normalized) {
      m.set(pos.id, calcPositionMetrics(pos, stockDataMap.get(pos.stockCode)));
    }
    return m;
  }, [normalized, stockDataMap]);

  const summary = useMemo(
    () => calcPortfolioSummary(normalized, stockDataMap),
    [normalized, stockDataMap]
  );

  return {
    positions: normalized,
    metrics,
    summary,
    stockDataMap,
    addPosition,
    removePosition,
    updatePosition,
    addDividend,
    removeDividend,
  };
}
