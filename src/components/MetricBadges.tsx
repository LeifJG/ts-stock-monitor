"use client";

// ─── 指标颜色条 ─────────────────────────────────────────────
// 用于 StockTable 中替代纯文字指标，用颜色条直观展示数值位置

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toFixed(d) : "--";

interface MetricBarProps {
  value: number | null | undefined;
  min?: number;
  max?: number;
  /** 超过此值变绿（好方向） */
  goodThreshold?: number;
  /** 超过此值变红（坏方向） */
  badThreshold?: number;
  /** true = 数值越高越好，false = 数值越低越好 */
  higherIsBetter?: boolean;
  /** 单位后缀 */
  unit?: string;
  /** 强制小数位 */
  decimals?: number;
  width?: number;
}

export function MetricBar({
  value, min = 0, max = 100,
  goodThreshold, badThreshold,
  higherIsBetter = true,
  unit = "", decimals = 1,
  width = 60,
}: MetricBarProps) {
  if (value == null) return <span style={{ color: "#9ca3af", fontSize: 12 }}>--</span>;

  // 计算百分比位置
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  // 颜色判断
  let color = "#6b7280";
  let bgColor = "rgba(107,114,128,0.15)";
  if (goodThreshold != null && (higherIsBetter ? value >= goodThreshold : value <= goodThreshold)) {
    color = "#16a34a";
    bgColor = "rgba(22,163,74,0.15)";
  } else if (badThreshold != null && (higherIsBetter ? value <= badThreshold : value >= badThreshold)) {
    color = "#ef4444";
    bgColor = "rgba(239,68,68,0.15)";
  } else if (goodThreshold != null && badThreshold != null) {
    // 中间值用黄色
    color = "#d97706";
    bgColor = "rgba(217,119,6,0.12)";
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width,
          height: 6,
          borderRadius: 3,
          background: bgColor,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(2, pct))}%`,
            height: "100%",
            borderRadius: 3,
            background: color,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 12, color, fontWeight: value > (goodThreshold ?? 999) ? 600 : 400 }}>
        {fmt(value, decimals)}{unit}
      </span>
    </div>
  );
}

// ─── PE 专用颜色条 ─────────────────────────────────────────
export function PEBadge({ pe }: { pe: number | null | undefined }) {
  return (
    <MetricBar
      value={pe}
      min={0}
      max={50}
      goodThreshold={10}
      badThreshold={30}
      higherIsBetter={false}
      unit=""
      decimals={1}
      width={50}
    />
  );
}

// ─── 股息率专用颜色条 ──────────────────────────────────────
export function DividendYieldBadge({ value }: { value: number | null | undefined }) {
  return (
    <MetricBar
      value={value}
      min={0}
      max={12}
      goodThreshold={5}
      higherIsBetter={true}
      unit="%"
      decimals={2}
      width={50}
    />
  );
}

// ─── 安全边际专用颜色条 ────────────────────────────────────
export function SafetyBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ color: "#9ca3af", fontSize: 12 }}>--</span>;

  const color = score >= 40 ? "#16a34a" : score >= 20 ? "#d97706" : "#ef4444";
  const label = score >= 60 ? "低估" : score >= 40 ? "偏低" : score >= 20 ? "合理" : "高估";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 50, height: 6, borderRadius: 3, background: "rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(2, score))}%`, height: "100%", borderRadius: 3, background: color }} />
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 12, color, fontWeight: 600 }}>
        {score.toFixed(0)}
      </span>
      <span style={{ fontSize: 10, color }}>({label})</span>
    </div>
  );
}

// ─── ROE 专用颜色条 ────────────────────────────────────────
export function ROEBadge({ roe }: { roe: number | null | undefined }) {
  return (
    <MetricBar
      value={roe}
      min={0}
      max={40}
      goodThreshold={20}
      higherIsBetter={true}
      unit="%"
      decimals={1}
      width={50}
    />
  );
}
