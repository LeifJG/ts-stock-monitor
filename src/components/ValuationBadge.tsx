// ============================================================
// ValuationBadge.tsx — 估值分位徽章（表格列用）
// ============================================================
// 显示 PE / PB 近5年历史分位，颜色分级：
//   <20%  低估（绿）   20-50% 偏低（蓝）
//   50-80% 偏高（金）   >80%  高估（红）

"use client";

import { Tooltip, Flex } from "antd";
import type { ValuationData } from "@/app/api/valuation/route";

function pctColor(pct: number | null | undefined): string {
  if (pct == null) return "var(--text-tertiary)";
  if (pct < 20) return "#22c55e";
  if (pct < 50) return "#3b82f6";
  if (pct < 80) return "#f59e0b";
  return "#ef4444";
}

function pctLabel(pct: number | null | undefined): string {
  if (pct == null) return "--";
  if (pct < 20) return "低估";
  if (pct < 50) return "偏低";
  if (pct < 80) return "偏高";
  return "高估";
}

function PctChip({ label, value }: { label: string; value: number | null | undefined }) {
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

  // 与操作建议引擎同一口径（portfolio_advice._blend）：
  //   · 窗口用 10 年（样本不足 8 年时 valuation_data.py 已把 10y 置空，这里退到全历史）
  //   · 指标混合 PE×0.6 + PB×0.4，缺一项就用另一项
  // 招行实录：5年 PE 分位 70.8%（偏高）但 10年 PE+PB 混合 32.3%（偏低），
  // 页面原来按 5年 PE 标「偏高」，日报按混合说「分位 30% 偏低」，同一只票两个结论。
  const pe = valuation.pe_pct_10y ?? valuation.pe_pct_all ?? null;
  const pb = valuation.pb_pct_10y ?? valuation.pb_pct_all ?? null;
  const blend = pe != null && pb != null ? pe * 0.6 + pb * 0.4 : (pe ?? pb);
  const label = pctLabel(blend);
  const labelColor = pctColor(blend);

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 11, lineHeight: 1.9 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📊 估值分位（10年 PE+PB 混合，与操作建议同口径）</div>
          <div>PE(TTM) {valuation.pe_ttm} · 10年 {pe ?? "--"}% · 5年 {valuation.pe_pct_5y ?? "--"}%
            · 1年 {valuation.pe_pct_1y ?? "--"}% · 5年中位 {valuation.pe_median_5y ?? "--"}</div>
          <div>PB {valuation.pb} · 10年 {pb ?? "--"}% · 5年 {valuation.pb_pct_5y ?? "--"}%
            · 5年中位 {valuation.pb_median_5y ?? "--"}</div>
          <div style={{ marginTop: 4 }}>混合分位 {blend != null ? `${blend.toFixed(1)}%` : "--"}（PE×0.6 + PB×0.4）</div>
          {(valuation as any).history_years != null && (
            <div style={{ color: "#a1a1aa", marginTop: 2 }}>
              样本 {Number((valuation as any).history_years).toFixed(1)} 年 · 不足 8 年时 10 年分位置空并退到全历史
            </div>
          )}
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
