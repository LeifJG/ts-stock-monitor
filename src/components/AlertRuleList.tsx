// ============================================================
// AlertRuleList.tsx — 告警规则列表
// ============================================================

"use client";

import { Switch, Tag, Button, Empty, Flex } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
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

  return (
    <Flex vertical gap={8}>
      {rules.map((rule) => (
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
          <Flex align="center" gap={10}>
            <Switch
              checked={rule.enabled}
              onChange={() => onToggle(rule.id)}
              size="small"
            />
            {rule.stockCode && (
              <Tag color="blue" style={{ fontFamily: "monospace", margin: 0 }}>
                {rule.stockCode}
              </Tag>
            )}
            <span style={{ fontSize: 14, color: rule.enabled ? "#1f2937" : "#9ca3af" }}>
              {rule.label}
            </span>
          </Flex>

          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onRemove(rule.id)}
          />
        </Flex>
      ))}
    </Flex>
  );
}
