// ============================================================
// AlertRuleForm.tsx — 添加告警规则的表单
// ============================================================

"use client";

import { useState } from "react";
import { Form, Select, Button, InputNumber, Flex } from "antd";
import { PlusOutlined } from "@ant-design/icons";
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

const FIELD_OPTIONS: { value: AlertField; label: string }[] = [
  "currentPrice", "changePercent", "pe", "pb", "marketCap",
  "dividendYield", "turnoverRate", "fearIndex", "volume",
  "roe", "dividendPayoutRatio", "debtRatio",
].map((f) => ({ value: f as AlertField, label: FIELD_LABELS[f] }));

const OP_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
];

export default function AlertRuleForm({ onAdd }: AlertRuleFormProps) {
  const [stockCode, setStockCode] = useState("");
  const [field, setField] = useState<AlertField>("dividendYield");
  const [operator, setOperator] = useState<AlertOperator>(">=");
  const [threshold, setThreshold] = useState<number | null>(null);

  const handleSubmit = () => {
    if (threshold == null || isNaN(threshold)) return;
    onAdd({ stockCode: stockCode.trim(), field, operator, value: threshold });
    setThreshold(null);
  };

  const unit = FIELD_UNITS[field] ?? "";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 12 }}>
        添加预警规则
      </h3>

      <Flex gap={12} wrap="wrap" align="end">
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>股票代码（选填）</div>
          <input
            type="text"
            placeholder="留空则全局"
            value={stockCode}
            onChange={(e) => setStockCode(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>

        <div style={{ minWidth: 120 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>监控字段</div>
          <Select
            value={field}
            onChange={(v) => setField(v)}
            options={FIELD_OPTIONS}
            style={{ width: "100%" }}
            size="small"
          />
        </div>

        <div style={{ minWidth: 80 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>条件</div>
          <Select
            value={operator}
            onChange={(v) => setOperator(v)}
            options={OP_OPTIONS}
            style={{ width: "100%" }}
            size="small"
          />
        </div>

        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>阈值{unit ? ` (${unit})` : ""}</div>
          <InputNumber
            value={threshold}
            onChange={(v) => setThreshold(v)}
            style={{ width: "100%" }}
            size="small"
            placeholder="0"
          />
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleSubmit}
          disabled={threshold == null}
          size="small"
        >
          添加规则
        </Button>
      </Flex>

      <Flex gap={6} wrap="wrap" style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
        <span>示例：</span>
        {["换手率 > 10%", "恐慌指数 > 80", "ROE < 5%"].map((ex) => (
          <code key={ex} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
            {ex}
          </code>
        ))}
      </Flex>
    </div>
  );
}
