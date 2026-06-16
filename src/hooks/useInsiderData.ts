// ============================================================
// useInsiderData.ts — 高管增减持数据 hook
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { InsiderTrade } from "@/lib/types";

interface InsiderResult {
  loading: boolean;
  trades: Map<string, InsiderTrade[]>;  // code → trades
  lastUpdated: Date | null;
  refetch: () => void;
}

/**
 * 获取自选股的高管增减持数据
 * 每 5 分钟自动刷新一次
 */
export function useInsiderData(codes: string[]): InsiderResult {
  const [trades, setTrades] = useState<Map<string, InsiderTrade[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    if (codes.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/insider?codes=${codes.join(",")}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map = new Map<string, InsiderTrade[]>();
        for (const item of json.data) {
          const code = item.code;
          if (!map.has(code)) map.set(code, []);
          map.get(code)!.push({
            date: item.date,
            name: item.person,
            position: item.position || "",
            changeType: item.volume > 0 ? "增持" : item.volume < 0 ? "减持" : "未知",
            volume: Math.abs(item.volume),
            price: item.price,
            ratio: 0, // 需要总股本才能计算，暂缺
          });
        }
        setTrades(map);
        setLastUpdated(new Date());
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [codes]);

  // 首次加载 + 每 5 分钟刷新
  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 5 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return { loading, trades, lastUpdated, refetch: fetchData };
}
