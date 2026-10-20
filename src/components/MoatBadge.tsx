// ============================================================
// MoatBadge.tsx — 护城河徽章（表格列内）
// 显示：评级色点 + 分数；点击回调打开详情弹窗
// ============================================================

"use client";

import { Tag } from "antd";

export interface MoatSummary {
  score: number;
  ratingLabel: string;
  rating: string;
}

export const RATING_COLOR: Record<string, string> = {
  wide: "var(--green)",    // 宽护城河
  narrow: "var(--blue)",   // 窄护城河
  none: "var(--text-tertiary)",
};

export default function MoatBadge({
  code,
  moat,
  onOpen,
}: {
  code: string;
  moat: MoatSummary | null;
  onOpen: (code: string) => void;
}) {
  if (!moat) return <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>--</span>;
  const color = RATING_COLOR[moat.rating] ?? "var(--text-tertiary)";
  return (
    <Tag
      onClick={(e) => {
        e.stopPropagation();
        onOpen(code);
      }}
      style={{ cursor: "pointer", fontSize: 11, borderColor: color, color }}
    >
      {moat.score} {moat.ratingLabel}
    </Tag>
  );
}
