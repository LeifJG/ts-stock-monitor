// ============================================================
// useAlertSync.ts — 预警规则同步到服务端
// ============================================================

"use client";

import { useEffect, useRef } from "react";
import type { AlertRule } from "@/lib/types";

export function useAlertSync(rules: AlertRule[]) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await fetch("/api/alerts/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: rules, settings: { pushToMobile: true } }),
        });
      } catch {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [rules]);
}
