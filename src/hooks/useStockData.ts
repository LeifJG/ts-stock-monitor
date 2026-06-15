// ============================================================
// useStockData.ts — 股票数据获取 Hook
// ============================================================

"use client";

import { useState, useEffect, useCallback } from "react";
import type { StockCode, StockData } from "@/lib/types";

interface UseStockDataResult {
  data: StockData[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

export function useStockData(codes: StockCode[]): UseStockDataResult {
  const [data, setData] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    if (codes.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ codes: codes.join(",") });
      const res = await fetch(`/api/stocks?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "请求失败");

      setData(json.data ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取数据失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [codes]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch, lastUpdated };
}
