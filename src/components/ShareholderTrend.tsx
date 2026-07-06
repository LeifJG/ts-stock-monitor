// ============================================================
// ShareholderTrend.tsx — 股东人数趋势图
// ============================================================
// 展示每季度股东户数变化趋势，判断筹码集中度

"use client";

import { useState, useEffect } from "react";
import { Card, Spin, Tag } from "antd";
import { TeamOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";

interface TrendPoint {
  date: string;
  holders: number;
  prevHolders: number | null;
  change: number | null;
  changePct: number;
  avgValue: number | null;
  avgShares: number | null;
}

interface ShareholderData {
  code: string;
  latestHolders: number;
  latestChangePct: number;
  trend: TrendPoint[];
}

interface Props {
  code: string;
  visible: boolean;
}

export default function ShareholderTrend({ code, visible }: Props) {
  const [data, setData] = useState<ShareholderData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !code) return;

    setLoading(true);
    fetch(`/api/shareholders?code=${code}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [code, visible]);

  if (!visible) return null;

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Spin size="small" />
      </div>
    );
  }

  if (!data || !data.trend || data.trend.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
        暂无股东人数数据
      </div>
    );
  }

  const trend = data.trend;
  const latest = trend[0];
  const isConcentrating = latest.changePct < 0; // 股东减少 = 筹码集中（利好）
  const maxHolders = Math.max(...trend.map((t) => t.holders));
  const minHolders = Math.min(...trend.map((t) => t.holders));
  const range = maxHolders - minHolders || 1;

  // SVG 尺寸
  const W = 300;
  const H = 100;
  const pad = { top: 8, right: 8, bottom: 20, left: 8 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  return (
    <div style={{ padding: "12px 0" }}>
      {/* 头部概况 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <TeamOutlined style={{ fontSize: 16, color: "var(--text-secondary)" }} />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>股东人数</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>
          {(latest.holders / 10000).toFixed(1)}万
        </span>
        <Tag
          color={isConcentrating ? "green" : "red"}
          style={{ margin: 0, fontSize: 11, lineHeight: "18px" }}
        >
          {isConcentrating ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
          {" "}{Math.abs(latest.changePct).toFixed(1)}%
        </Tag>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          {isConcentrating ? "筹码集中 ↑" : "筹码分散 ↓"}
        </span>
      </div>

      {/* SVG 折线图 */}
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* Y轴参考线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = pad.top + chartH * (1 - ratio);
          return (
            <line
              key={ratio}
              x1={pad.left}
              y1={y}
              x2={W - pad.right}
              y2={y}
              stroke="var(--border-color, rgba(255,255,255,0.06))"
              strokeWidth={0.5}
            />
          );
        })}
        {/* 面积填充 */}
        <defs>
          <linearGradient id={`grad-${code}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isConcentrating ? "#22c55e" : "#ef4444"} stopOpacity={0.25} />
            <stop offset="100%" stopColor={isConcentrating ? "#22c55e" : "#ef4444"} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path
          d={[
            "M",
            ...trend
              .map((t, i) => {
                const x = pad.left + (i / Math.max(trend.length - 1, 1)) * chartW;
                const y = pad.top + chartH * (1 - (t.holders - minHolders) / range);
                return `${i === 0 ? "" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
              }),
            `L${pad.left + chartW},${pad.top + chartH}`,
            `L${pad.left},${pad.top + chartH}`,
            "Z",
          ].join(" ")}
          fill={`url(#grad-${code})`}
        />
        {/* 折线 */}
        <polyline
          points={trend
            .map((t, i) => {
              const x = pad.left + (i / Math.max(trend.length - 1, 1)) * chartW;
              const y = pad.top + chartH * (1 - (t.holders - minHolders) / range);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={isConcentrating ? "#22c55e" : "#ef4444"}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 数据点 & X轴标签 */}
        {trend.map((t, i) => {
          const x = pad.left + (i / Math.max(trend.length - 1, 1)) * chartW;
          const y = pad.top + chartH * (1 - (t.holders - minHolders) / range);
          const showLabel = i % Math.max(1, Math.floor(trend.length / 4)) === 0 || i === trend.length - 1;
          return (
            <g key={t.date}>
              <circle cx={x} cy={y} r={2.5} fill={isConcentrating ? "#22c55e" : "#ef4444"} />
              {showLabel && (
                <text
                  x={x}
                  y={H - 2}
                  textAnchor="middle"
                  fill="var(--text-tertiary, #888)"
                  fontSize={8}
                >
                  {t.date.slice(2, 7).replace("-", "")}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* 数据表格（最新 N 期） */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          gap: "2px 12px",
          fontSize: 11,
          color: "var(--text-secondary)",
          marginTop: 4,
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}>截止日</span>
        <span style={{ color: "var(--text-tertiary)" }}>股东户数</span>
        <span style={{ color: "var(--text-tertiary)" }}>变化</span>
        <span style={{ color: "var(--text-tertiary)" }}>户均持股</span>

        {trend.slice(0, 8).map((t) => (
          <div
            key={t.date}
            style={{
              display: "contents",
              opacity: t === latest ? 1 : 0.7,
            }}
          >
            <span>{t.date.slice(0, 7)}</span>
            <span style={{ fontFamily: "monospace" }}>
              {(t.holders / 10000).toFixed(1)}万
            </span>
            <span
              style={{
                fontFamily: "monospace",
                color: t.changePct < 0
                  ? "var(--green, #22c55e)"
                  : t.changePct > 0
                    ? "var(--red, #ef4444)"
                    : undefined,
              }}
            >
              {t.changePct > 0 ? "+" : ""}
              {t.changePct.toFixed(1)}%
            </span>
            <span style={{ fontFamily: "monospace" }}>
              {t.avgShares ? `${(t.avgShares / 10000).toFixed(1)}万` : "--"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
