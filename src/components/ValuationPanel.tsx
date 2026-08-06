// ============================================================
// ValuationPanel.tsx — 估值分位详情面板（展开行用）
// ============================================================
// 展示 PE/PB 历史分位条、5年极值区间、近250日 PE 走势迷你图

"use client";

import { useState, useEffect } from "react";
import { Spin, Tag } from "antd";
import { LineChartOutlined } from "@ant-design/icons";
import type { ValuationData } from "@/app/api/valuation/route";

interface Props {
  code: string;
  visible: boolean;
}

function pctColor(pct: number | undefined): string {
  if (pct == null) return "var(--text-tertiary)";
  if (pct < 20) return "#22c55e";
  if (pct < 50) return "#3b82f6";
  if (pct < 80) return "#f59e0b";
  return "#ef4444";
}

function pctLabel(pct: number | undefined): string {
  if (pct == null) return "--";
  if (pct < 20) return "低估";
  if (pct < 50) return "偏低";
  if (pct < 80) return "偏高";
  return "高估";
}

// ─── 单条分位进度条 ─────────────────────────────────────────
function PercentileBar({ label, value, min, max, median }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  median: number;
}) {
  const color = pctColor(value);
  const pct = value ?? 0;

  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: "monospace" }}>
          {value != null ? `${value.toFixed(1)}% · ${pctLabel(value)}` : "--"}
        </span>
      </div>
      {/* 分段条：5段等分，当前值用marker */}
      <div
        style={{
          position: "relative",
          height: 12,
          borderRadius: 6,
          background: "linear-gradient(to right, rgba(34,197,94,0.5), rgba(59,130,246,0.5) 50%, rgba(239,68,68,0.5))",
          overflow: "hidden",
        }}
      >
        {/* 中位线 */}
        <div style={{ position: "absolute", left: `${Math.min(Math.max(median / (max - min || 1) * 100, 0), 100)}%` }} />
        {/* 当前值 marker */}
        {value != null && (
          <div
            style={{
              position: "absolute",
              top: -2,
              bottom: -2,
              width: 2,
              left: `${Math.min(Math.max(pct, 0), 100)}%`,
              background: color,
              boxShadow: "0 0 4px rgba(0,0,0,0.4)",
            }}
          />
        )}
        {/* 5年区间刻度 */}
        <div style={{ position: "absolute", left: 0, top: "100%", fontSize: 9, color: "var(--text-tertiary)" }}>
          {min}
        </div>
        <div style={{ position: "absolute", right: 0, top: "100%", fontSize: 9, color: "var(--text-tertiary)" }}>
          {max}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>0%</span>
        <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>100%</span>
      </div>
    </div>
  );
}

// ─── PE 迷你走势图 ──────────────────────────────────────────
function PeMiniChart({ history }: { history: NonNullable<ValuationData["history"]> }) {
  const W = 280;
  const H = 56;
  const pad = { top: 4, right: 4, bottom: 12, left: 4 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const vals = history
    .map((h) => h.pe)
    .filter((v): v is number => v != null);
  if (vals.length < 2) return null;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const pts = vals
    .map((v, i) => {
      const x = pad.left + (i / Math.max(vals.length - 1, 1)) * chartW;
      const y = pad.top + chartH * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, marginBottom: 4 }}>
        近一年 PE(TTM) 走势
      </div>
      <svg width={W} height={H} style={{ display: "block" }}>
        <polyline
          points={pts}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {vals.map((v, i) => {
          const x = pad.left + (i / Math.max(vals.length - 1, 1)) * chartW;
          const y = pad.top + chartH * (1 - (v - min) / range);
          const showLabel = i === 0 || i === vals.length - 1;
          return showLabel ? (
            <text
              key={i}
              x={x}
              y={H - 1}
              textAnchor={i === 0 ? "start" : "end"}
              fill="var(--text-tertiary)"
              fontSize={8}
            >
              {v.toFixed(1)}
            </text>
          ) : null;
        })}
      </svg>
    </div>
  );
}

export default function ValuationPanel({ code, visible }: Props) {
  const [data, setData] = useState<ValuationData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !code) return;
    setLoading(true);
    fetch(`/api/valuation?codes=${code}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data && json.data.length > 0) setData(json.data[0]);
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

  if (!data) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
        暂无估值分位数据（请先运行 scripts/valuation_data.py）
      </div>
    );
  }

  const pePct = data.pe_pct_5y;
  const pbPct = data.pb_pct_5y;
  const overall = (pePct ?? 50) < 30 ? "低估区" : (pePct ?? 50) < 60 ? "合理区" : "高估区";
  const overallColor = pctColor(pePct);

  return (
    <div style={{ padding: "12px 0" }}>
      {/* 头部概况 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <LineChartOutlined style={{ fontSize: 16, color: "var(--text-secondary)" }} />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>估值分位</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>
          PE {data.pe_ttm}
        </span>
        <Tag color={overallColor} style={{ margin: 0, fontSize: 11, lineHeight: "18px" }}>
          {overall}
        </Tag>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          数据截至 {data.updated_at}
        </span>
      </div>

      {/* 分位条 + 迷你图 */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <PercentileBar
          label="PE(TTM) 5年分位"
          value={pePct}
          min={data.pe_min_5y}
          max={data.pe_max_5y}
          median={data.pe_median_5y}
        />
        <PercentileBar
          label="PB 5年分位"
          value={pbPct}
          min={data.pb_min_5y}
          max={data.pb_max_5y}
          median={data.pb_median_5y}
        />
        {data.history && <PeMiniChart history={data.history} />}
      </div>

      {/* 3年/1年分位 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "4px 12px",
          fontSize: 11,
          color: "var(--text-secondary)",
          marginTop: 14,
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}>窗口</span>
        <span style={{ color: "var(--text-tertiary)" }}>PE 分位</span>
        <span style={{ color: "var(--text-tertiary)" }}>PB 分位</span>
        {(["1y", "3y", "5y"] as const).map((w) => {
          const keyPE = `pe_pct_${w}` as "pe_pct_1y" | "pe_pct_3y" | "pe_pct_5y";
          const keyPB = `pb_pct_${w}` as "pb_pct_1y" | "pb_pct_3y" | "pb_pct_5y";
          const pePctW: number | undefined = data[keyPE];
          const pbPctW: number | undefined = data[keyPB];
          return (
            <div key={w} style={{ display: "contents" }}>
              <span>近{w[0]}年</span>
              <span style={{ fontFamily: "monospace", color: pctColor(pePctW) }}>
                {pePctW != null ? `${pePctW.toFixed(1)}%` : "--"}
              </span>
              <span style={{ fontFamily: "monospace", color: pctColor(pbPctW) }}>
                {pbPctW != null ? `${pbPctW.toFixed(1)}%` : "--"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
