// ============================================================
// DonutChart.tsx — 纯 SVG 持仓分布环形图（无第三方依赖）
// ============================================================
// 展示各持仓占总投资的比例，用不同颜色的弧段表示。

"use client";

import { useMemo } from "react";
import type { Position } from "@/lib/types";

// ─── 调色板（暗色/浅色通用，不依赖主题） ───────────────────
const COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#6366f1",
];

interface DonutChartProps {
  positions: Position[];
  /** 获取某持仓的当前市值回调 */
  getMarketValue?: (position: Position) => number;
  /** 获取某持仓的名称回调 */
  getLabel?: (position: Position) => string;
  /** 直径（默认 140） */
  size?: number;
  /** 环形内径比（默认 0.6，即内径为 60% 外径） */
  innerRadiusRatio?: number;
}

export default function DonutChart({
  positions,
  getMarketValue,
  getLabel,
  size = 140,
  innerRadiusRatio = 0.6,
}: DonutChartProps) {
  const segments = useMemo(() => {
    // 移除市值为 0 的持仓
    const active = positions.filter((p) => {
      const mv = getMarketValue?.(p) ?? 0;
      return mv > 0;
    });

    const total = active.reduce(
      (sum, p) => sum + (getMarketValue?.(p) ?? 0),
      0
    );

    if (total === 0) return [];

    let currentAngle = 0;
    return active.map((p, i) => {
      const mv = getMarketValue?.(p) ?? 0;
      const pct = (mv / total) * 100;
      const angle = (pct / 100) * 360;
      const startAngle = currentAngle;
      currentAngle += angle;
      return {
        key: p.id,
        label: getLabel?.(p) ?? p.stockName ?? p.stockCode,
        value: mv,
        pct,
        color: COLORS[i % COLORS.length],
        startAngle,
        endAngle: currentAngle,
      };
    });
  }, [positions, getMarketValue, getLabel]);

  if (segments.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2; // 留 2px 边距
  const innerR = outerR * innerRadiusRatio;

  // ─── 将角度转为 SVG 弧路径 ──────────────────────────────
  const polarToCartesian = (
    cx: number,
    cy: number,
    r: number,
    angleDeg: number
  ): { x: number; y: number } => {
    const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 让 0 度在顶部
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (
    startAngle: number,
    endAngle: number
  ): string => {
    // 修正：startAngle 可能等于 0 或全圆
    const totalAngle = endAngle - startAngle;
    if (totalAngle >= 359.999) {
      // 几乎整圆，拆两段避免 SVG 渲染 bug
      const mid = startAngle + totalAngle / 2;
      return (
        describeArc(startAngle, mid) +
        " " +
        describeArc(mid, endAngle)
      );
    }

    const start = polarToCartesian(cx, cy, outerR, startAngle);
    const end = polarToCartesian(cx, cy, outerR, endAngle);
    const startInner = polarToCartesian(cx, cy, innerR, endAngle);
    const endInner = polarToCartesian(cx, cy, innerR, startAngle);

    const largeArc = totalAngle > 180 ? 1 : 0;

    return [
      `M ${start.x} ${start.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${end.x} ${end.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
      "Z",
    ].join(" ");
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0 }}
    >
      {segments.map((seg) => (
        <path
          key={seg.key}
          d={describeArc(seg.startAngle, seg.endAngle)}
          fill={seg.color}
          opacity={0.85}
        />
      ))}
      {/* 中心文字：总股票数 */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.1}
        fontWeight={600}
        fill="var(--text-primary, #171717)"
      >
        {positions.length}
      </text>
      <text
        x={cx}
        y={cy + size * 0.07}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.065}
        fill="var(--text-tertiary, #808080)"
      >
        只
      </text>
    </svg>
  );
}

// ─── 图例组件 ──────────────────────────────────────────────
export function DonutLegend({
  segments,
}: {
  segments: Array<{ key: string; label: string; value: number; pct: number; color: string }>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {segments.map((seg) => (
        <div
          key={seg.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-primary)",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: seg.color,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {seg.label}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-tertiary)" }}>
            {seg.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
