// ============================================================
// IndexCards.tsx — 大盘指数卡片（Vercel 风格）
// ============================================================

"use client";

import { Progress, Tag, Skeleton, Flex } from "antd";
import type { IndexData } from "@/lib/types";

interface IndexCardsProps {
  indices: IndexData[];
  loading: boolean;
}

export default function IndexCards({ indices, loading }: IndexCardsProps) {
  if (loading) {
    return (
      <Flex gap={12} style={{ marginBottom: 16 }}>
        <Skeleton.Button active style={{ width: 210, height: 80 }} />
        <Skeleton.Button active style={{ width: 210, height: 80 }} />
      </Flex>
    );
  }
  if (indices.length === 0) return null;

  return (
    <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
      {indices.map((idx) => {
        const { quote, fearGauge } = idx;
        const isUp = quote.changePercent > 0;
        const changeColor = isUp ? "#ef4444" : "#22c55e";

        return (
          <div
            key={quote.code}
            style={{
              width: 210,
              borderRadius: 8,
              padding: "14px 16px",
              background: "#fff",
              boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)",
            }}
          >
            {/* 名称 + 涨跌幅 */}
            <Flex justify="space-between" align="center">
              <span style={{ fontWeight: 500, fontSize: 14, color: "#171717" }}>{quote.name}</span>
              <Tag color={isUp ? "red" : "green"} style={{ margin: 0, borderRadius: 9999, fontSize: 12, fontWeight: 500 }}>
                {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
              </Tag>
            </Flex>

            {/* 指数值 */}
            <Flex align="baseline" gap={6} style={{ marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: changeColor, letterSpacing: "-0.48px" }}>
                {quote.currentPrice.toFixed(2)}
              </span>
              <span style={{ fontSize: 12, color: changeColor }}>
                {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
              </span>
            </Flex>

            {/* 恐慌进度条 */}
            <Flex align="center" gap={6} style={{ marginTop: 10 }}>
              <span style={{ fontSize: 11, color: fearGauge.overall < 40 ? "#22c55e" : fearGauge.overall < 60 ? "#ca8a04" : "#ef4444", fontWeight: 500 }}>
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
              <span style={{ fontSize: 11, color: "#808080" }}>{fearGauge.overall}</span>
            </Flex>
          </div>
        );
      })}
    </Flex>
  );
}
