// ============================================================
// useAlerts.ts — 告警规则管理 Hook（数据持久化到 localStorage）
// ============================================================
// 管理告警规则的增删改查，并在数据更新时自动评估规则是否触发。
// 所有规则自动保存到浏览器 localStorage，刷新不丢失。

"use client";

import { useState, useCallback } from "react";
import type { AlertRule, AlertTrigger, StockData, AlertField, AlertOperator } from "@/lib/types";
import { evaluateAlerts, describeRule } from "@/lib/alert-engine";
import { useLocalStorage } from "./useLocalStorage";

/** localStorage 存储键名 */
const STORAGE_KEY = "ts-stock-monitor:alertRules";

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
  // 规则持久化到 localStorage，刷新不丢失
  const [rules, setRules] = useLocalStorage<AlertRule[]>(STORAGE_KEY, []);

  // 触发状态是临时的，不持久化
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
    [setRules]
  );

  const removeRule = useCallback(
    (id: string) => {
      setRules((prev) => prev.filter((r) => r.id !== id));
    },
    [setRules]
  );

  const toggleRule = useCallback(
    (id: string) => {
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
      );
    },
    [setRules]
  );

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
    [setRules]
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
