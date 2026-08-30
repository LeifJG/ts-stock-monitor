// ============================================================
// usePortfolioStocks.ts — 持仓股票实时行情（共享缓存）
// ------------------------------------------------------------
// 解决「持仓里的股票不在 watchlist（如港股）拿不到实时价」的问题。
// 模块级缓存 + in-flight 去重：多个组件（MiniCard/Summary/Panel）
// 同时挂载时，60 秒内只发一次 /api/stocks 请求。
// ============================================================

import { useEffect, useState } from "react";
import type { StockData } from "@/lib/types";

const CACHE_TTL = 55_000; // 略小于轮询间隔，保证多组件共享同一次请求

const cache: {
  map: Map<string, StockData> | null;
  ts: number;
  inflight: Promise<Map<string, StockData>> | null;
} = { map: null, ts: 0, inflight: null };

async function loadQuotes(codes: string[]): Promise<Map<string, StockData>> {
  // 缓存命中
  if (cache.map && Date.now() - cache.ts < CACHE_TTL) return cache.map;
  // in-flight 去重
  if (!cache.inflight) {
    cache.inflight = fetch(`/api/stocks?codes=${codes.join(",")}`)
      .then((r) => r.json())
      .then((json) => {
        const m = new Map<string, StockData>();
        if (json.success && Array.isArray(json.data)) {
          json.data.forEach((s: StockData) => m.set(s.quote.code, s));
        }
        cache.map = m;
        cache.ts = Date.now();
        return m;
      })
      .catch(() => cache.map ?? new Map<string, StockData>())
      .finally(() => {
        cache.inflight = null;
      });
  }
  return cache.inflight;
}

/**
 * 拉取指定代码列表的实时行情，返回 Map<code, StockData>
 * @param codes 需要行情的股票代码
 */
export function usePortfolioStocks(codes: string[]): Map<string, StockData> {
  const [map, setMap] = useState<Map<string, StockData>>(() => cache.map ?? new Map());
  const key = codes.join(",");

  useEffect(() => {
    if (!key) return;
    let alive = true;

    const tick = async () => {
      const m = await loadQuotes(key.split(","));
      if (alive) setMap(m);
    };

    tick();
    const timer = setInterval(tick, 60_000); // 每分钟刷新
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);

  return map;
}
