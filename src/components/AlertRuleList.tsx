// ============================================================
// AlertRuleList.tsx — 告警规则列表
// ============================================================

"use client";

import type { AlertRule } from "@/lib/types";
import { FIELD_LABELS, FIELD_UNITS } from "@/lib/constants";

interface AlertRuleListProps {
  rules: AlertRule[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function AlertRuleList({ rules, onToggle, onRemove }: AlertRuleListProps) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        暂无预警规则，在上方添加一条吧
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition ${
            rule.enabled
              ? "border-gray-200 bg-white"
              : "border-gray-100 bg-gray-50 opacity-60"
          }`}
        >
          <div className="flex items-center gap-2">
            {/* 开关 */}
            <button
              onClick={() => onToggle(rule.id)}
              className={`h-5 w-9 rounded-full transition-colors ${
                rule.enabled ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  rule.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>

            {/* 规则描述 */}
            <div>
              {rule.stockCode && (
                <span className="mr-1.5 rounded bg-blue-50 px-1.5 py-0.5 font-mono text-xs text-blue-600">
                  {rule.stockCode}
                </span>
              )}
              <span className={rule.enabled ? "text-gray-800" : "text-gray-400"}>
                {rule.label}
              </span>
            </div>
          </div>

          {/* 删除 */}
          <button
            onClick={() => onRemove(rule.id)}
            className="ml-2 rounded px-2 py-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
            title="删除规则"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
