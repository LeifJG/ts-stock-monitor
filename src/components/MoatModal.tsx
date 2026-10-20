// ============================================================
// MoatModal.tsx — 护城河详情弹窗
// 展示：评分环 + 五维度条 + ROIC/毛利率迷你序列 + LLM 叙述四段
// ============================================================

"use client";

import { useEffect, useState } from "react";
import { Modal, Spin, Tag, Progress } from "antd";
import { ThunderboltOutlined, WarningOutlined } from "@ant-design/icons";

interface MoatDim {
  score: number;
  max: number;
  [k: string]: unknown;
}

interface Narrative {
  moat_type: string;
  moat_summary: string;
  moat_desc: string;
  moat_strengths: string[];
  moat_risks: string[];
  durability: string;
  durability_reason: string;
}

interface MoatData {
  code: string;
  score: number;
  rating: string;
  ratingLabel: string;
  dims: Record<string, MoatDim>;
  series?: { roic?: [string, number][]; grossMargin?: [string, number][] };
  narrative?: Narrative;
}

const RATING_COLOR: Record<string, string> = {
  wide: "#22c55e",
  narrow: "#3b82f6",
  none: "#71717a",
};

function Sparkline({ points, color }: { points: [string, number][]; color: string }) {
  if (!points || points.length < 2) return null;
  const vals = points.map(([, v]) => v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 220;
  const h = 36;
  const path = points
    .map(([, v], i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <svg width={w} height={h} style={{ display: "block" }}>
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
      <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
        {points[0][0]} → {points[points.length - 1][0]}（{vals[0]} → {vals[vals.length - 1]}%）
      </div>
    </div>
  );
}

export default function MoatModal({
  code,
  name,
  open,
  onClose,
}: {
  code: string | null;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<MoatData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !code) return;
    setLoading(true);
    setData(null);
    fetch(`/api/moat?codes=${code}`)
      .then((r) => r.json())
      .then((j) => setData(j?.data?.[code] ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, code]);

  const color = data ? RATING_COLOR[data.rating] ?? "#71717a" : "#71717a";

  return (
    <Modal
      title={name ? `${name} · 护城河分析` : "护城河分析"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : !data ? (
        <div style={{ color: "var(--text-tertiary)", textAlign: "center", padding: 32, fontSize: 12 }}>
          暂无该股票的护城河数据（运行 scripts/moat_data.py 生成）
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 总分 + 评级 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Progress
              type="dashboard"
              percent={data.score}
              size={90}
              strokeColor={color}
              format={() => <span style={{ fontSize: 18, fontWeight: 600 }}>{data.score}</span>}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color }}>
                {data.ratingLabel}
              </div>
              {data.narrative?.moat_type && (
                <div style={{ marginTop: 4 }}>
                  <Tag style={{ fontSize: 11 }}>{data.narrative.moat_type}</Tag>
                </div>
              )}
              {data.narrative?.moat_summary && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  {data.narrative.moat_summary}
                </div>
              )}
            </div>
          </div>

          {/* 五维度 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
            {Object.entries(data.dims).map(([k, v]) => (
              <div key={k}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{k}</span>
                  <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                    {v.score}/{v.max}
                  </span>
                </div>
                <Progress
                  percent={Math.round((v.score / v.max) * 100)}
                  size="small"
                  showInfo={false}
                  strokeColor={color}
                />
              </div>
            ))}
          </div>

          {/* 序列迷你图 */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {data.series?.roic && data.series.roic.length >= 2 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>
                  ROIC / ROE（年度%）
                </div>
                <Sparkline points={data.series.roic} color="#3b82f6" />
              </div>
            )}
            {data.series?.grossMargin && data.series.grossMargin.length >= 2 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>
                  毛利率（年度%）
                </div>
                <Sparkline points={data.series.grossMargin} color="#22c55e" />
              </div>
            )}
          </div>

          {/* LLM 叙述 */}
          {data.narrative ? (
            <>
              <div
                style={{
                  fontSize: 12.5, lineHeight: 1.7, padding: "10px 12px", borderRadius: 8,
                  background: "var(--bg-card)", border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                }}
              >
                {data.narrative.moat_desc}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  <ThunderboltOutlined /> 支撑点
                </div>
                {data.narrative.moat_strengths.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2 }}>
                    · {s}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  <WarningOutlined style={{ color: "#f59e0b" }} /> 侵蚀风险
                </div>
                {data.narrative.moat_risks.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2 }}>
                    · {s}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <Tag color={data.narrative.durability === "10年以上" ? "green" : data.narrative.durability === "不确定" ? "default" : "blue"} style={{ fontSize: 11 }}>
                  可持续性 {data.narrative.durability}
                </Tag>
                <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                  {data.narrative.durability_reason}
                </span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              叙述未生成（运行 scripts/moat_narrative.py）
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
