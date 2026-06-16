// ============================================================
// DividendBadge.tsx — 分红历史标签 + 贵族徽章
// ============================================================

"use client";

import { Tag, Tooltip } from "antd";
import { CrownOutlined, RiseOutlined } from "@ant-design/icons";

interface DividendYearRecord {
  year: string;
  total: number;
  growth?: number | null;
}

interface DividendData {
  code: string;
  records: Array<{ date: string; perShare: number }>;
  yearly: DividendYearRecord[];
  streak: number;
  aristocrat: boolean;
  totalYears: number;
}

interface DividendBadgeProps {
  data?: DividendData | null;
}

/** 格式化金额 */
const fmt = (v: number): string =>
  v >= 1 ? v.toFixed(3) : v.toFixed(4);

/** 分红标签组件 */
export default function DividendBadge({ data }: DividendBadgeProps) {
  if (!data || !data.yearly || data.yearly.length === 0) {
    return <span style={{ color: "#9ca3af", fontSize: 12 }}>--</span>;
  }

  const { aristocrat, streak, yearly, records } = data;
  const latest = yearly[yearly.length - 1];
  const prev = yearly.length > 1 ? yearly[yearly.length - 2] : null;

  const latestGrowth = latest?.growth;

  // 颜色
  let color = "#9ca3af";
  if (aristocrat) color = "#d97706"; // 金色
  else if (latestGrowth != null && latestGrowth > 0) color = "#16a34a";
  else if (latestGrowth != null && latestGrowth < 0) color = "#dc2626";

  const tooltipContent = (
    <div style={{ fontSize: 11, lineHeight: 1.8, minWidth: 220 }}>
      {aristocrat && (
        <div style={{ color: "#fbbf24", fontWeight: 700, marginBottom: 4 }}>
          🏆 分红贵族 · 连续 {streak} 年增长
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#9ca3af", fontSize: 10 }}>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>年份</th>
            <th style={{ textAlign: "right", padding: "2px 4px" }}>每股分红</th>
            <th style={{ textAlign: "right", padding: "2px 4px" }}>增长</th>
          </tr>
        </thead>
        <tbody>
          {yearly.slice(-8).map((y) => (
            <tr key={y.year}>
              <td style={{ padding: "1px 4px", color: "#d1d5db" }}>{y.year}</td>
              <td style={{ padding: "1px 4px", textAlign: "right", fontFamily: "monospace" }}>
                ¥{fmt(y.total)}
              </td>
              <td style={{
                padding: "1px 4px", textAlign: "right", fontFamily: "monospace",
                color: y.growth != null ? (y.growth > 0 ? "#4ade80" : y.growth < 0 ? "#f87171" : "#9ca3af") : "#9ca3af",
              }}>
                {y.growth != null ? (y.growth > 0 ? "+" : "") + y.growth.toFixed(1) + "%" : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {records && records.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid #374151", paddingTop: 4 }}>
          <div style={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}>最近分红</div>
          {records.slice(0, 3).map((r, i) => (
            <div key={i} style={{ fontFamily: "monospace", fontSize: 10, color: "#d1d5db" }}>
              {r.date} · ¥{fmt(r.perShare)}/股
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip title={tooltipContent} color="#1f2937" overlayStyle={{ minWidth: 240 }}>
      <Tag
        style={{
          margin: 0,
          fontSize: 12,
          fontFamily: "var(--font-geist-mono)",
          border: `1px solid ${color}`,
          background: `${color}11`,
          borderRadius: 9999,
          cursor: "pointer",
          color,
        }}
      >
        {aristocrat && <CrownOutlined style={{ marginRight: 2 }} />}
        {latestGrowth != null && latestGrowth > 0 && !aristocrat && <RiseOutlined style={{ marginRight: 2 }} />}
        ¥{latest ? fmt(latest.total) : "--"}
        {streak > 0 && !aristocrat && <span style={{ marginLeft: 2, fontSize: 10 }}>×{streak}</span>}
      </Tag>
    </Tooltip>
  );
}
