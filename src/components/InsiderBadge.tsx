// ============================================================
// InsiderBadge.tsx — 高管增减持标签
// ============================================================

"use client";

import { Tag, Tooltip } from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import type { InsiderTrade } from "@/lib/types";

interface InsiderBadgeProps {
  trades?: InsiderTrade[];
}

/**
 * 展示最近一次高管增减持记录
 * - 绿色=增持（利好）
 * - 红色=减持（利空）
 * - 灰色=无记录
 */
export default function InsiderBadge({ trades }: InsiderBadgeProps) {
  if (!trades || trades.length === 0) {
    return <span style={{ color: "#9ca3af", fontSize: 12 }}>--</span>;
  }

  // 按日期排序，取最近一条
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];

  const isBuy = latest.changeType === "增持";
  const isSell = latest.changeType === "减持";

  const color = isBuy ? "#16a34a" : isSell ? "#dc2626" : "#9ca3af";
  const icon = isBuy
    ? <ArrowUpOutlined />
    : isSell
    ? <ArrowDownOutlined />
    : <MinusOutlined />;

  // 格式化数量：万或亿
  const fmtVolume = (v: number): string => {
    if (v >= 1_0000_0000) return (v / 1_0000_0000).toFixed(2) + "亿";
    if (v >= 1_0000) return (v / 1_0000).toFixed(0) + "万";
    return v.toLocaleString();
  };

  const tooltipContent = (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      <div><strong>{latest.name}</strong>（{latest.position}）</div>
      <div>
        {latest.date} · {isBuy ? "增持" : "减持"}
        <span style={{ color, fontWeight: 700, marginLeft: 4 }}>
          {fmtVolume(latest.volume)}股
        </span>
      </div>
      {latest.price && <div>均价 ¥{latest.price.toFixed(2)}</div>}
    </div>
  );

  return (
    <Tooltip title={tooltipContent} color="#1f2937">
      <Tag
        style={{
          margin: 0,
          fontSize: 12,
          fontFamily: "var(--font-geist-mono)",
          color,
          border: `1px solid ${color}`,
          background: `${color}11`,
          borderRadius: 9999,
          cursor: "pointer",
        }}
      >
        {icon}
        {" "}
        {fmtVolume(latest.volume)}
      </Tag>
    </Tooltip>
  );
}
