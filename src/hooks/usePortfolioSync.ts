// ============================================================
// usePortfolioSync.ts — 持仓数据同步到服务端
// ============================================================

"use client";

import { useEffect, useRef } from "react";
import type { Position } from "@/lib/types";

/**
 * 监听持仓数据变化，自动同步到服务端
 */
export function usePortfolioSync(positions: Position[]) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return; // 首次加载不同步，避免覆盖空数据
    }

    const timer = setTimeout(async () => {
      try {
        await fetch("/api/portfolio/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // route 期望 { data: [...] } 包裹（裸数组会被 400 拒绝）
          body: JSON.stringify({ data: positions }),
        });
      } catch {
        // 静默失败
      }
    }, 1000); // 防抖 1 秒

    return () => clearTimeout(timer);
  }, [positions]);
}
