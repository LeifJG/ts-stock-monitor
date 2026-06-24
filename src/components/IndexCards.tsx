// ============================================================
// IndexCards.tsx — 大盘指数卡片（深色模式适配版）
// ============================================================

"use client";

import { Progress, Tag, Skeleton, Flex } from "antd";
import type { IndexData } from "@/lib/types";
import { priceColorFn, fearColor } from "@/lib/format";

interface IndexCardsProps {
  indices: IndexData[];
  loading: boolean;
}

export default function IndexCards({ indices, loading }: IndexCardsProps) {
  if (loading) {
    return (
      <Flex gap={12} style={{ marginBottom: 16 }} wrap="wrap">
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
        const pColor = priceColorFn(quote.changePercent);
        const fc = fearColor(fearGauge.overall);

        return (
          <div
            key={quote.code}
            style={{
              borderRadius: 8,
              padding: "14px 16px",
              minWidth: 180,
              flex: "1 1 180px",
              maxWidth: 260,
              background: "var(--bg-card)",
              boxShadow: "var(--card-shadow)",
              transition: "box-shadow 0.2s ease, transform 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "var(--card-shadow), 0 4px 12px rgba(0,0,0,0.1)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "var(--card-shadow)";
              e.currentTarget.style.transform = "none";
            }}
          >
            {/* 名称 + 涨跌幅 */}
            <Flex justify="space-between" align="center">
              <span style={{ fontWeight: 500, fontSize: 14, color: "var(--text-primary)" }}>{quote.name}</span>
              <Tag color={isUp ? "red" : "green"} style={{ margin: 0, borderRadius: 9999, fontSize: 12, fontWeight: 500 }}>
                {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
              </Tag>
            </Flex>

            {/* 指数值 */}
            <Flex align="baseline" gap={6} style={{ marginTop: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: pColor, letterSpacing: "-0.48px" }}>
                {quote.currentPrice.toFixed(2)}
              </span>
              <span style={{ fontSize: 12, color: pColor }}>
                {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
              </span>
            </Flex>

            {/* 恐慌进度条 */}
            <Flex align="center" gap={6} style={{ marginTop: 10 }}>
              <span style={{ fontSize: 11, color: fc.text, fontWeight: 500 }}>
                {fearGauge.label}
              </span>
              <Progress
                percent={fearGauge.overall}
                size="small"
                style={{ flex: 1, marginBottom: 0 }}
                strokeColor={fc.bar}
                trailColor="var(--border-secondary)"
                showInfo={false}
              />
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{fearGauge.overall}</span>
            </Flex>
          </div>
        );
      })}
    </Flex>
  );
}
