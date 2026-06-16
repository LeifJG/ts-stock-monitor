// ============================================================
// useDividendHistory.ts — 历史分红数据 hook
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";

interface DividendYearRecord {
  year: string;
  total: number;
  growth?: number | null;
}

interface DividendData {
  code: string;
  records: Array<{ date: string; perShare: number }>;
  yearly: DividendYearRecord[];
  streak: number;
  aristocrat: boolean;
  totalYears: number;
}

interface DividendResult {
  loading: boolean;
  data: Map<string, DividendData>;
  lastUpdated: Date | null;
  refetch: () => void;
}

export function useDividendHistory(codes: string[]): DividendResult {
  const [dataMap, setDataMap] = useState<Map<string, DividendData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    if (codes.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dividends?codes=${codes.join(",")}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map = new Map<string, DividendData>();
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
    timerRef.current = setInterval(fetchData, 30 * 60 * 1000); // 30分钟刷新
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return { loading, data: dataMap, lastUpdated, refetch: fetchData };
}
