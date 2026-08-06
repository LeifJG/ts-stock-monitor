// ============================================================
// ValuationBadge.tsx — 估值分位徽章（表格列用）
// ============================================================
// 显示 PE / PB 近5年历史分位，颜色分级：
//   <20%  低估（绿）   20-50% 偏低（蓝）
//   50-80% 偏高（金）   >80%  高估（红）

"use client";

import { Tooltip, Flex } from "antd";
import type { ValuationData } from "@/app/api/valuation/route";

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

function PctChip({ label, value }: { label: string; value: number | undefined }) {
  const color = pctColor(value);
  return (
    <Flex align="center" gap={3} style={{ minWidth: 0 }}>
      <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>{label}</span>
      <div
        style={{
          position: "relative",
          width: 30,
          height: 5,
          borderRadius: 3,
          background: "rgba(128,128,128,0.18)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {value != null && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.min(Math.max(value, 2), 100)}%`,
              borderRadius: 3,
              background: color,
            }}
          />
        )}
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color, fontFamily: "monospace" }}>
        {value != null ? `${value.toFixed(0)}%` : "--"}
      </span>
    </Flex>
  );
}

export default function ValuationBadge({ valuation }: { valuation?: ValuationData }) {
  if (!valuation) {
    return <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>--</span>;
  }

  const pe = valuation.pe_pct_5y;
  const pb = valuation.pb_pct_5y;
  const label = pctLabel(pe);
  const labelColor = pctColor(pe);

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 11, lineHeight: 1.9 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📊 估值历史分位（5年）</div>
          <div>PE(TTM) {valuation.pe_ttm} · 分位 {pe ?? "--"}% · 中位 {valuation.pe_median_5y}</div>
          <div>PB {valuation.pb} · 分位 {pb ?? "--"}% · 中位 {valuation.pb_median_5y}</div>
          <div style={{ color: "#a1a1aa", marginTop: 4 }}>分位越低 = 当前估值在历史上越便宜</div>
        </div>
      }
      color="#27272a"
      placement="top"
    >
      <Flex align="center" gap={6} style={{ cursor: "help" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "0 5px",
            lineHeight: "16px",
            borderRadius: 9999,
            whiteSpace: "nowrap",
            color: labelColor,
            background: `${labelColor}1f`,
          }}
        >
          {label}
        </span>
        <PctChip label="PE" value={pe} />
        <PctChip label="PB" value={pb} />
      </Flex>
    </Tooltip>
  );
}
