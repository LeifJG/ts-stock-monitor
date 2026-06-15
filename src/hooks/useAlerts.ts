// ============================================================
// useAlerts.ts — 告警规则管理 Hook
// ============================================================
// 管理告警规则的增删改查，并在数据更新时自动评估规则是否触发。

"use client";

import { useState, useCallback, useMemo } from "react";
import type { AlertRule, AlertTrigger, StockData, AlertField, AlertOperator } from "@/lib/types";
import { evaluateAlerts, describeRule } from "@/lib/alert-engine";

interface UseAlertsResult {
  rules: AlertRule[];
  triggers: AlertTrigger[];
  addRule: (rule: Omit<AlertRule, "id" | "label" | "enabled">) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  updateRule: (id: string, updates: Partial<AlertRule>) => void;
  evaluate: (stockDataMap: Map<string, StockData>) => void;
}

let _nextId = 1;
function genId(): string {
  return `rule_${Date.now()}_${_nextId++}`;
}

export function useAlerts(): UseAlertsResult {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [triggers, setTriggers] = useState<AlertTrigger[]>([]);

  const addRule = useCallback(
    (input: Omit<AlertRule, "id" | "label" | "enabled">) => {
      const rule: AlertRule = {
        ...input,
        id: genId(),
        label: describeRule(input as AlertRule),
        enabled: true,
      };
      setRules((prev) => [...prev, rule]);
    },
    []
  );

  const removeRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleRule = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }, []);

  const updateRule = useCallback(
    (id: string, updates: Partial<AlertRule>) => {
      setRules((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const merged = { ...r, ...updates };
          return { ...merged, label: describeRule(merged) };
        })
      );
    },
    []
  );

  const evaluate = useCallback(
    (stockDataMap: Map<string, StockData>) => {
      const result = evaluateAlerts(rules, stockDataMap);
      setTriggers(result);
    },
    [rules]
  );

  return {
    rules,
    triggers,
    addRule,
    removeRule,
    toggleRule,
    updateRule,
    evaluate,
  };
}
