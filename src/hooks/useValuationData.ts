// ============================================================
// useValuationData.ts — 估值分位数据 hook
// ============================================================
// 从 /api/valuation 读取 PE/PB 历史分位数据，缓存为 Map<code, ValuationData>

import { useState, useEffect, useCallback, useRef } from "react";
import type { ValuationData } from "@/app/api/valuation/route";

interface ValuationResult {
  loading: boolean;
  data: Map<string, ValuationData>;
  lastUpdated: Date | null;
  refetch: () => void;
}

export function useValuationData(codes: string[]): ValuationResult {
  const [dataMap, setDataMap] = useState<Map<string, ValuationData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    if (codes.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/valuation?codes=${codes.join(",")}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map = new Map<string, ValuationData>();
        for (const item of json.data) {
          map.set(item.code, item);
        }
        setDataMap(map);
        setLastUpdated(new Date());
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [codes]);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 60 * 60 * 1000); // 1小时刷新
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return { loading, data: dataMap, lastUpdated, refetch: fetchData };
}
