// ============================================================
// AlertRuleForm.tsx — 添加告警规则的表单
// ============================================================
// 提供股票代码（可选）、监控字段、比较条件和阈值的输入，提交时生成告警规则。

"use client";

import { useState } from "react";
import type { AlertField, AlertOperator, StockCode } from "@/lib/types";
import { FIELD_LABELS, FIELD_UNITS } from "@/lib/constants";

interface AlertRuleFormProps {
  onAdd: (rule: {
    stockCode: StockCode;
    field: AlertField;
    operator: AlertOperator;
    value: number;
  }) => void;
}

const FIELDS: AlertField[] = [
  "currentPrice", "changePercent", "pe", "pb", "marketCap",
  "dividendYield", "turnoverRate", "fearIndex", "volume",
];

const OPERATORS: AlertOperator[] = [">", ">=", "<", "<=", "=="];

export default function AlertRuleForm({ onAdd }: AlertRuleFormProps) {
  const [stockCode, setStockCode] = useState("");
  const [field, setField] = useState<AlertField>("dividendYield");
  const [operator, setOperator] = useState<AlertOperator>(">=");
  const [threshold, setThreshold] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(threshold);
    if (isNaN(value)) return;

    onAdd({
      stockCode: stockCode.trim(),
      field,
      operator,
      value,
    });

    setThreshold("");
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-gray-700">添加预警规则</h3>

      <div className="grid grid-cols-4 gap-2">
        {/* 股票代码 */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">股票代码（选填）</label>
          <input
            type="text"
            placeholder="留空则全局"
            value={stockCode}
            onChange={(e) => setStockCode(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>

        {/* 字段 */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">监控字段</label>
          <select
            value={field}
            onChange={(e) => setField(e.target.value as AlertField)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          >
            {FIELDS.map((f) => (
              <option key={f} value={f}>{FIELD_LABELS[f]}</option>
            ))}
          </select>
        </div>

        {/* 操作符 */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">条件</label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as AlertOperator)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
        </div>

        {/* 阈值 */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">
            阈值 ({FIELD_UNITS[field] ?? ""})
          </label>
          <input
            type="number"
            step="any"
            placeholder="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1 text-xs text-gray-400">
          <span>示例：</span>
          <code className="rounded bg-gray-100 px-1 py-0.5">换手率 &gt; 10%</code>
          <code className="rounded bg-gray-100 px-1 py-0.5">恐慌指数 &gt; 80</code>
          <code className="rounded bg-gray-100 px-1 py-0.5">成交量 &gt; 5000万手</code>
        </div>
        <button
          type="submit"
          disabled={!threshold || isNaN(parseFloat(threshold))}
          className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          添加规则
        </button>
      </div>
    </form>
  );
}
