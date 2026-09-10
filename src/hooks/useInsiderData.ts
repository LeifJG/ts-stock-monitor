// ============================================================
// useInsiderData.ts — 高管增减持 + 港股回购数据 hook
// ============================================================
// API 返回结构（scripts/fetch_insider.py）：
//   { success, data: { insiders: {code: [...]}, buybacks: {code: [...] } } }
// 30 分钟刷新一次（公告级低频数据；后端另有内存缓存）

import { useState, useEffect, useCallback, useRef } from "react";
import type { InsiderTrade, InsiderBuyback } from "@/lib/types";

interface InsiderResult {
  loading: boolean;
  trades: Map<string, InsiderTrade[]>;      // code → A股增减持
  buybacks: Map<string, InsiderBuyback[]>;  // code → 港股回购
  lastUpdated: Date | null;
  refetch: () => void;
}

export function useInsiderData(codes: string[]): InsiderResult {
  const [trades, setTrades] = useState<Map<string, InsiderTrade[]>>(new Map());
  const [buybacks, setBuybacks] = useState<Map<string, InsiderBuyback[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (codes.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/insider?codes=${codes.join(",")}`);
      const json = await res.json();
      if (json.success && json.data && typeof json.data === "object") {
        // 新结构 { insiders: {code:[]}, buybacks: {code:[]} }
        const insMap = new Map<string, InsiderTrade[]>();
        const bbMap = new Map<string, InsiderBuyback[]>();
        for (const [code, rows] of Object.entries(json.data.insiders ?? {})) {
          type Row = { person?: string; changeType?: string; volume?: number; ratio?: number; holdAfter?: number; startDate?: string; endDate?: string; pubDate?: string; price?: number | null };
          const list = (rows as Row[]).map((item) => ({
            date: item.startDate || item.pubDate || "",
            name: item.person ?? "",
            position: "",
            changeType: (item.changeType as "增持" | "减持" | "未知") ?? "未知",
            volume: Math.abs(item.volume ?? 0),
            price: item.price ?? 0,
            ratio: (item.ratio ?? 0) as number,
            person: item.person,
            holdAfter: item.holdAfter,
            startDate: item.startDate,
            endDate: item.endDate,
            pubDate: item.pubDate,
          }));
          insMap.set(code, list);
        }
        for (const [code, rows] of Object.entries(json.data.buybacks ?? {})) {
          bbMap.set(code, rows as InsiderBuyback[]);
        }
        setTrades(insMap);
        setBuybacks(bbMap);
        setLastUpdated(new Date());
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [codes]);

  // 首次加载 + 每 30 分钟刷新
  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 30 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return { loading, trades, buybacks, lastUpdated, refetch: fetchData };
}
