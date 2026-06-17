// ============================================================
// RefreshTimer.tsx — 自动刷新控制栏（Vercel 风格）
// ============================================================

"use client";

import { useEffect, useState, useRef } from "react";
import { Select, Button, Tag, Flex, Typography } from "antd";
import { ReloadOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { getMarketStatus, shouldAutoRefresh, type MarketStatus } from "@/lib/market-time";

const { Text } = Typography;

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
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(getMarketStatus());

  // 每分钟更新市场状态
  useEffect(() => {
    setMarketStatus(getMarketStatus());
    const tick = setInterval(() => setMarketStatus(getMarketStatus()), 30000);
    return () => clearInterval(tick);
  }, []);

  // 收盘后自动停刷新
  const autoPaused = useRef(false);
  useEffect(() => {
    const open = shouldAutoRefresh();
    if (!open && interval > 0 && !autoPaused.current) {
      autoPaused.current = true;
      onIntervalChange(0); // 自动设为关闭
    } else if (open && autoPaused.current) {
      autoPaused.current = false;
      // 恢复上次有效间隔（默认 10 秒）
      onIntervalChange(10);
    }
  }, [marketStatus.isOpen, interval, onIntervalChange]);

  const statusColor = marketStatus.isOpen ? "#16a34a" : "#9ca3af";
  const statusLabel = marketStatus.isOpen
    ? (marketStatus.session === "morning" ? "上午盘" : "盘中")
    : (marketStatus.isToday ? "已收盘" : "休市");
  const statusHint = marketStatus.isOpen
    ? marketStatus.nextClose
    : marketStatus.nextOpen;

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
        {/* 市场状态 */}
        <Tag
          icon={<ClockCircleOutlined />}
          color={marketStatus.isOpen ? "green" : "default"}
          style={{ margin: 0, fontSize: 11, lineHeight: "20px" }}
        >
          {statusLabel}
        </Tag>
        {statusHint && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {statusHint}
          </Text>
        )}

        {/* 刷新间隔 */}
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
