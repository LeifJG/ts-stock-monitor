// ============================================================
// IndexCards.tsx — 大盘指数卡片
// ============================================================
// 展示上证指数 + 创业板指，带涨跌幅颜色和恐慌指数进度条。

"use client";

import { Card, Statistic, Progress, Tag, Skeleton, Flex } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import type { IndexData } from "@/lib/types";

interface IndexCardsProps {
  indices: IndexData[];
  loading: boolean;
}

export default function IndexCards({ indices, loading }: IndexCardsProps) {
  if (loading) {
    return (
      <Flex gap={12} className="mb-4">
        <Skeleton.Button active style={{ width: 200, height: 90 }} />
        <Skeleton.Button active style={{ width: 200, height: 90 }} />
      </Flex>
    );
  }
  if (indices.length === 0) return null;

  return (
    <Flex gap={12} wrap="wrap" className="mb-4">
      {indices.map((idx) => {
        const { quote, fearGauge } = idx;
        const isUp = quote.changePercent > 0;

        return (
          <Card
            key={quote.code}
            size="small"
            style={{ width: 210 }}
            styles={{ body: { padding: "14px 16px" } }}
          >
            <Flex justify="space-between" align="center">
              <span style={{ fontWeight: 600, fontSize: 14, color: "#374151" }}>
                {quote.name}
              </span>
              <Tag color={isUp ? "red" : "green"} style={{ margin: 0 }}>
                {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
              </Tag>
            </Flex>

            <Flex align="baseline" gap={6} style={{ marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: isUp ? "#ef4444" : "#22c55e" }}>
                {quote.currentPrice.toFixed(2)}
              </span>
              <span style={{ fontSize: 12, color: isUp ? "#ef4444" : "#22c55e" }}>
                {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
              </span>
            </Flex>

            <Flex align="center" gap={8} style={{ marginTop: 10 }}>
              <span style={{ fontSize: 11, color: fearGauge.overall < 40 ? "#22c55e" : fearGauge.overall < 60 ? "#eab308" : "#ef4444", fontWeight: 500 }}>
                {fearGauge.label}
              </span>
              <Progress
                percent={fearGauge.overall}
                size="small"
                style={{ flex: 1, marginBottom: 0 }}
                strokeColor={fearGauge.overall < 40 ? "#22c55e" : fearGauge.overall < 60 ? "#eab308" : "#ef4444"}
                trailColor="#f3f4f6"
                showInfo={false}
              />
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                {fearGauge.overall}
              </span>
            </Flex>
          </Card>
        );
      })}
    </Flex>
  );
}
