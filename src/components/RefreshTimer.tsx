// ============================================================
// RefreshTimer.tsx — 自动刷新控制栏（Vercel 风格）
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

export default function RefreshTimer({ interval, onIntervalChange, lastUpdated, onRefresh, loading }: RefreshTimerProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      wrap="wrap"
      gap={12}
      style={{
        borderRadius: 8,
        padding: "10px 16px",
        background: "#fff",
        boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)",
      }}
    >
      <Flex align="center" gap={12} wrap="wrap">
        <span style={{ fontSize: 13, color: "#808080", fontWeight: 500 }}>自动刷新</span>
        <Select value={interval} onChange={onIntervalChange} options={OPTIONS} style={{ width: 90 }} size="small" variant="borderless" />
        {lastUpdated && (
          <span style={{ fontSize: 12, color: "#bfbfbf" }}>
            更新于 {lastUpdated.toLocaleTimeString("zh-CN")}
          </span>
        )}
      </Flex>
      <Button icon={<ReloadOutlined spin={loading} />} onClick={onRefresh} loading={loading} size="small" type="text">
        刷新
      </Button>
    </Flex>
  );
}
