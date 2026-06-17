// ============================================================
// AlertRuleList.tsx — 告警规则列表（含类型标签 + 推送状态）
// ============================================================

"use client";

import { Switch, Tag, Button, Empty, Flex, Tooltip } from "antd";
import { DeleteOutlined, MobileOutlined } from "@ant-design/icons";
import type { AlertRule } from "@/lib/types";

interface AlertRuleListProps {
  rules: AlertRule[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function AlertRuleList({ rules, onToggle, onRemove }: AlertRuleListProps) {
  if (rules.length === 0) {
    return <Empty description="暂无预警规则，在上方添加一条吧" style={{ padding: "24px 0" }} />;
  }

  const ruleTypeLabel = (r: AlertRule): { label: string; color: string } => {
    const t = r.alertType;
    if (t === "costBasis") return { label: "成本价", color: "red" };
    if (t === "dividendDate") return { label: "分红日", color: "green" };
    return { label: "常规", color: "blue" };
  };

  return (
    <Flex vertical gap={8}>
      {rules.map((rule) => {
        const typeInfo = ruleTypeLabel(rule);
        return (
          <Flex
            key={rule.id}
            align="center"
            justify="space-between"
            className="rounded-lg border px-3.5 py-2.5 transition"
            style={{
              borderColor: rule.enabled ? "#e5e7eb" : "#f3f4f6",
              background: rule.enabled ? "#fff" : "#f9fafb",
              opacity: rule.enabled ? 1 : 0.6,
            }}
          >
            <Flex align="center" gap={6}>
              <Switch
                checked={rule.enabled}
                onChange={() => onToggle(rule.id)}
                size="small"
              />
              <Tag color={typeInfo.color} style={{ fontSize: 10, lineHeight: "14px", margin: 0, border: 0 }}>
                {typeInfo.label}
              </Tag>
              {rule.stockCode && (
                <Tag color="default" style={{ fontFamily: "monospace", fontSize: 10, margin: 0 }}>
                  {rule.stockCode}
                </Tag>
              )}
              <span style={{ fontSize: 13, color: rule.enabled ? "#1f2937" : "#9ca3af" }}>
                {rule.label}
              </span>
              {rule.pushToMobile && (
                <Tooltip title="推送微信">
                  <MobileOutlined style={{ fontSize: 12, color: "#3b82f6", cursor: "help" }} />
                </Tooltip>
              )}
            </Flex>

            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onRemove(rule.id)}
            />
          </Flex>
        );
      })}
    </Flex>
  );
}
