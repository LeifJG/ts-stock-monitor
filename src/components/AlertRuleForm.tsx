// ============================================================
// AlertRuleForm.tsx — 添加告警规则的表单（含成本价/分红日预警）
// ============================================================

"use client";

import { useState } from "react";
import { Form, Select, Button, InputNumber, Flex, Tag, Divider, Switch } from "antd";
import { PlusOutlined, MobileOutlined } from "@ant-design/icons";
import type { AlertField, AlertOperator, AlertType, StockCode } from "@/lib/types";
import { FIELD_LABELS, FIELD_UNITS } from "@/lib/constants";

interface AlertRuleFormProps {
  onAdd: (rule: {
    stockCode: StockCode;
    field: AlertField;
    operator: AlertOperator;
    value: number;
    alertType?: AlertType;
    pushToMobile?: boolean;
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

const ALERT_TYPE_OPTIONS: { value: AlertType; label: string; desc: string }[] = [
  { value: "field", label: "常规预警", desc: "监控字段值" },
  { value: "costBasis", label: "🔴 跌穿成本价", desc: "现价比成本低 X% 时提醒" },
  { value: "dividendDate", label: "🟢 分红日提醒", desc: "除权日前 X 天提醒" },
];

export default function AlertRuleForm({ onAdd }: AlertRuleFormProps) {
  const [stockCode, setStockCode] = useState("");
  const [alertType, setAlertType] = useState<AlertType>("field");
  const [field, setField] = useState<AlertField>("dividendYield");
  const [operator, setOperator] = useState<AlertOperator>(">=");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [pushToMobile, setPushToMobile] = useState(true);

  const handleSubmit = () => {
    if (threshold == null || isNaN(threshold)) return;
    onAdd({
      stockCode: stockCode.trim(),
      field: alertType === "field" ? field : "currentPrice",
      operator: alertType === "field" ? operator : ">=",
      value: threshold,
      alertType,
      pushToMobile,
    });
    setThreshold(null);
  };

  const unit = FIELD_UNITS[field] ?? "";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>添加预警规则</span>
        <Tag icon={<MobileOutlined />} color="blue" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
          推送微信
        </Tag>
      </Flex>

      {/* 告警类型选择 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>告警类型</div>
        <Flex gap={6} wrap="wrap">
          {ALERT_TYPE_OPTIONS.map((opt) => (
            <Tag
              key={opt.value}
              color={alertType === opt.value ? "blue" : "default"}
              style={{
                cursor: "pointer", padding: "2px 8px", fontSize: 12,
                borderRadius: 9999,
              }}
              onClick={() => setAlertType(opt.value)}
            >
              {opt.label}
            </Tag>
          ))}
        </Flex>
      </div>

      <Flex gap={12} wrap="wrap" align="end">
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>股票代码（选填）</div>
          <input
            type="text"
            placeholder="留空则全部持仓"
            value={stockCode}
            onChange={(e) => setStockCode(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>

        {alertType === "field" && (
          <>
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
          </>
        )}

        <div style={{ minWidth: alertType === "dividendDate" ? 140 : 100 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
            {alertType === "costBasis" ? "跌幅阈值 (%)" :
             alertType === "dividendDate" ? "提前天数" :
             `阈值${unit ? ` (${unit})` : ""}`}
          </div>
          <InputNumber
            value={threshold}
            onChange={(v) => setThreshold(v)}
            style={{ width: "100%" }}
            size="small"
            placeholder={alertType === "costBasis" ? "5" : alertType === "dividendDate" ? "3" : "0"}
          />
        </div>

        <div style={{ minWidth: 80 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>推送微信</div>
          <Switch
            checked={pushToMobile}
            onChange={setPushToMobile}
            size="small"
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleSubmit}
          disabled={threshold == null}
          size="small"
        >
          添加
        </Button>
      </Flex>

      <Divider style={{ margin: "10px 0" }} />

      <Flex gap={6} wrap="wrap" style={{ fontSize: 12, color: "#9ca3af" }}>
        <span>推荐预警：</span>
        {[
          "跌穿成本价 5%",
          "分红前 3 天提醒",
          "股息率 < 2%",
          "PE > 30",
        ].map((ex) => (
          <code key={ex} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
            {ex}
          </code>
        ))}
      </Flex>
    </div>
  );
}
