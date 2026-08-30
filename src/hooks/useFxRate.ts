// ============================================================
// useFxRate.ts — 客户端港币汇率注入（P1-5）
// 挂载时拉一次 /api/fx，此后每 6 小时刷新；注入 stockUtils 模块级
// 汇率，portfolio-calc 全部港股换算随之生效。失败静默（回退 0.86）。
// ============================================================

"use client";

import { useEffect } from "react";
import { setHkdRate } from "@/lib/stockUtils";

const REFRESH_MS = 6 * 3600 * 1000;

export function useFxRate(): void {
  useEffect(() => {
    let stopped = false;

    async function load() {
      try {
        const res = await fetch("/api/fx");
        if (!res.ok) return;
        const json = await res.json();
        if (!stopped && json?.success && !json?.stale) {
          setHkdRate(json.rate);
        }
      } catch {
        // 静默：服务端不可用时沿用默认汇率
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
