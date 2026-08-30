// ============================================================
// useVolatility.ts — 真实历史波动率步长（网格用）
// ------------------------------------------------------------
// 数据来自 /api/volatility（akshare 日K 20日σ，当日缓存）。
// 返回 Map<stockCode, stepPct>，供 computeAllGridPlans 使用。
// ============================================================

"use client";

import { useEffect, useState } from "react";

export function useVolatility(): {
  steps: Map<string, number>;
  loading: boolean;
  error: string | null;
} {
  const [steps, setSteps] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/volatility")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.success && j.data) {
          const m = new Map<string, number>();
          Object.entries(j.data).forEach(([code, v]) => {
            const step = (v as { step?: number }).step;
            if (step && step > 0) m.set(code, step);
          });
          setSteps(m);
          setError(j.stale ? "波动率数据非今日（今日生成失败，使用旧缓存）" : null);
        } else {
          setError(j.error || "波动率数据不可用");
        }
      })
      .catch((e) => alive && setError(e.message || "网络错误"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { steps, loading, error };
}
