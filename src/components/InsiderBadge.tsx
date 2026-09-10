// ============================================================
// InsiderBadge.tsx — 高管增减持 / 港股回购标签
// ============================================================
// A股票：显示最近一次股东增减持（绿=增持 红=减持）
// 港股票：显示最近一次公司回购（橙色，回购=利好）
// 点击弹出最近 8 条明细

"use client";

import { useState } from "react";
import { Tag, Tooltip, Modal } from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import type { InsiderTrade } from "@/lib/types";

interface InsiderBadgeProps {
  trades?: InsiderTrade[];       // A股增减持（01810 等港股为空）
  buybacks?: InsiderBuyback[];   // 港股回购记录
  stockName?: string;
}

export interface InsiderBuyback {
  date: string;
  volume: number;     // 万股
  avgPrice: number;
  amount: number;     // 万港元
  currency: string;
}

/** 数量格式化：万/亿 */
function fmtVolume(v: number): string {
  if (v >= 10000) return (v / 10000).toFixed(2) + "亿";
  if (v >= 1) return v.toFixed(v >= 100 ? 0 : 1) + "万";
  return v.toLocaleString();
}

/** 金额格式化：万→亿 */
function fmtAmount(w: number): string {
  if (w >= 10000) return (w / 10000).toFixed(2) + "亿";
  return w.toFixed(0) + "万";
}

export default function InsiderBadge({ trades, buybacks, stockName }: InsiderBadgeProps) {
  const [open, setOpen] = useState(false);
  const hasBuyback = buybacks && buybacks.length > 0;
  const latest = trades && trades.length > 0 ? trades[0] : null;
  const latestBb = hasBuyback ? buybacks![0] : null;

  if (!latest && !latestBb) {
    return <span style={{ color: "#9ca3af", fontSize: 12 }}>--</span>;
  }

  // ── A股：增减持徽章 ──
  const isBuy = latest?.changeType === "增持";
  const isSell = latest?.changeType === "减持";
  const color = latest ? (isBuy ? "#16a34a" : isSell ? "#dc2626" : "#9ca3af")
                       : "#ea580c";  // 回购橙色
  const icon = latest
    ? (isBuy ? <ArrowUpOutlined /> : isSell ? <ArrowDownOutlined /> : <MinusOutlined />)
    : <span>▸</span>;
  const label = latest ? "增减" : "回购";
  const headlineVolume = latest ? latest.volume : latestBb!.volume;

  // ── 弹窗内容：最近 8 条 ──
  const modalContent = (
    <div style={{ maxHeight: 420, overflowY: "auto", fontSize: 12.5, lineHeight: 1.7 }}>
      {latest && trades && (
        <>
          <div style={{ fontWeight: 700, margin: "4px 0 8px", color: "#374151" }}>
            📊 股东增减持（最近 {trades.length} 条）
          </div>
          {trades.map((t, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <strong style={{ color: t.changeType === "增持" ? "#16a34a" : "#dc2626" }}>
                  {t.changeType}
                </strong>
                {" "}
                {fmtVolume(t.volume)}万股
                {t.price != null && t.price > 0 && <span style={{ color: "#6b7280" }}> · 均价 ¥{t.price.toFixed(2)}</span>}
                <span style={{ color: "#9ca3af", fontSize: 11, marginLeft: 6 }}>{t.pubDate}</span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>
                {t.person}
                {t.ratio != null && t.ratio > 0 && ` · 占总股本 ${t.ratio}%`}
                {t.holdAfter != null && t.holdAfter > 0 && ` · 变动后持 ${(t.holdAfter / 10000).toFixed(2)}亿股`}
              </div>
            </div>
          ))}
        </>
      )}
      {latestBb && buybacks && (
        <>
          <div style={{ fontWeight: 700, margin: "12px 0 8px", color: "#374151" }}>
            🏢 公司回购（最近 {buybacks.length} 笔）
          </div>
          {buybacks.map((b, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <strong style={{ color: "#ea580c" }}>回购</strong>
                {" "}
                {fmtVolume(b.volume)}万股
                <span style={{ color: "#6b7280" }}> · 均价 {b.avgPrice.toFixed(2)}</span>
                <span style={{ color: "#9ca3af", fontSize: 11, marginLeft: 6 }}>{b.date}</span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>
                金额 {fmtAmount(b.amount)}{b.currency === "HKD" ? "港元" : ""}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  return (
    <>
      <Tooltip
        title={latest
          ? `${latest.person} · ${latest.changeType}${fmtVolume(latest.volume)}万股 · ${latest.pubDate}`
          : `${stockName ?? ""}回购 · ${fmtVolume(latestBb!.volume)}万股 @${latestBb!.avgPrice.toFixed(2)} · ${latestBb!.date}`}
        color="#1f2937"
      >
        <Tag
          onClick={() => setOpen(true)}
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
          {label === "增减" ? (isBuy ? "↑" : "↓") : "▸"} {fmtVolume(headlineVolume)}股
        </Tag>
      </Tooltip>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        title={`${stockName ?? ""} · 股东增减持 / 公司回购`}
        width={480}
      >
        {modalContent}
      </Modal>
    </>
  );
}
