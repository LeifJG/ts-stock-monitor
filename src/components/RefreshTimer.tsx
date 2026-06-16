// ============================================================
// RefreshTimer.tsx — 自动刷新控制栏
// ============================================================

"use client";

import { Select, Button, Tag, Flex } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

interface RefreshTimerProps {
  interval: number;
  onIntervalChange: (sec: number) => void;
  lastUpdated: Date | null;
  onRefresh: () => void;
  loading: boolean;
}

const OPTIONS = [
  { value: 5, label: "5 秒" },
  { value: 10, label: "10 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "60 秒" },
  { value: 0, label: "关闭" },
];

export default function RefreshTimer({
  interval,
  onIntervalChange,
  lastUpdated,
  onRefresh,
  loading,
}: RefreshTimerProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      wrap="wrap"
      gap={12}
      className="rounded-xl border border-gray-200 bg-white px-4 py-3"
    >
      <Flex align="center" gap={12} wrap="wrap">
        <span style={{ fontSize: 14, color: "#6b7280" }}>自动刷新：</span>
        <Select
          value={interval}
          onChange={onIntervalChange}
          options={OPTIONS}
          style={{ width: 100 }}
          size="small"
        />
        {lastUpdated && (
          <Tag color="default" style={{ fontSize: 12 }}>
            更新于 {lastUpdated.toLocaleTimeString("zh-CN")}
          </Tag>
        )}
      </Flex>

      <Button
        icon={<ReloadOutlined spin={loading} />}
        onClick={onRefresh}
        loading={loading}
        size="small"
      >
        刷新
      </Button>
    </Flex>
  );
}
