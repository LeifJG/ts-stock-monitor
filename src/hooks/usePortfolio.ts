// ============================================================
// usePortfolio.ts — 持仓管理 hook（localStorage 持久化）
// ------------------------------------------------------------
// 计算逻辑统一走 src/lib/portfolio-calc.ts（唯一口径）；
// 实时行情自动合并（含 watchlist 之外的港股，走共享缓存）。
// ============================================================

"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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

// ─── 服务端回灌（P0-2：防 localStorage 丢失）──────────────────
// localStorage 为空（首次访问/清缓存/换浏览器）时，从服务端
// portfolio.json 恢复持仓+分红记录。非空则不动（本地永远是真源）。

async function restoreFromServer(setPositions: (p: Position[]) => void): Promise<void> {
  try {
    const res = await fetch("/api/portfolio");
    if (!res.ok) return;
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    if (!list.length) return;
    // 竞态保护：等待期间用户已手动添加持仓 → 放弃回灌
    if (localStorage.getItem(STORAGE_KEY)) return;
    const cleaned = normalizePositions(list);
    if (!cleaned.length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    setPositions(cleaned);
  } catch {
    // 服务端不可用时静默，不影响本地使用
  }
}

// ─── Hook ─────────────────────────────────────────────────────

/**
 * @param externalMap 页面级行情（watchlist 内股票），可缺省——
 *                    持仓里不在 watchlist 的股票（港股等）会自动通过
 *                    usePortfolioStocks 拉取并合并
 */
export function usePortfolio(externalMap?: Map<string, StockData>) {
  // hydration 安全：首渲染固定空数组（与 SSR 一致），mount 后再读 localStorage。
  // 若惰性初始化直读 localStorage，PortfolioMiniCard 等组件首渲染与 SSR HTML
  // 不匹配 → React #418 → 事件树与 DOM 脱节（表现为添加自选后表格不刷新）。
  const [positions, setPositions] = useState<Position[]>([]);

  // 挂载后同步：读 localStorage 真实持仓；为空 → 从服务端回灌（每页面加载最多尝试一次）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;
    const loaded = loadPositions();
    if (loaded.length > 0) {
      setPositions(loaded);
    } else if (!localStorage.getItem(STORAGE_KEY)) {
      restoreFromServer(setPositions);
    }
  }, []);

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
