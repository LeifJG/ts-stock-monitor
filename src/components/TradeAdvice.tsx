// ============================================================
// TradeAdvice.tsx — 交易建议卡片
// ============================================================
// 在「添加持仓」弹窗中展示：操作建议、止盈/止损/加仓/减仓价、
// 决策依据（估值分位、安全边际、综合评分等）。

"use client";

import { Flex, Tag, Spin } from "antd";
import {
  AimOutlined, SafetyOutlined, FallOutlined, RiseOutlined,
  PlusCircleOutlined, MinusCircleOutlined, CheckCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { ACTION_META, type TradeAdvice } from "@/lib/trade-advice";

// ─── 价位展示块 ─────────────────────────────────────────────

function PriceBlock({ icon, label, value, color, hint }: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  color: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 84,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(128,128,128,0.06)",
        border: "1px solid rgba(128,128,128,0.12)",
        textAlign: "center",
      }}
      title={hint}
    >
      <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>
        {value != null ? `¥${value.toFixed(2)}` : "--"}
      </div>
    </div>
  );
}

// ─── 理由/风险行 ────────────────────────────────────────────

function Line({ ok, text }: { ok: boolean; text: string }) {
  const color = ok ? "var(--green)" : "var(--red)";
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11, lineHeight: 1.6 }}>
      <span style={{ color, flexShrink: 0, marginTop: 2 }}>
        {ok ? <CheckCircleOutlined /> : <WarningOutlined />}
      </span>
      <span style={{ color: ok ? "var(--text-secondary)" : color }}>{text}</span>
    </div>
  );
}

// ─── 组件 ───────────────────────────────────────────────────

export default function TradeAdviceCard({ advice, loading }: { advice: TradeAdvice | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <Spin size="small" />
      </div>
    );
  }

  if (!advice) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 8,
          border: "1px dashed var(--border-color)",
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: 12,
        }}
      >
        输入股票代码后，自动生成操作建议、止盈止损价
      </div>
    );
  }

  const meta = ACTION_META[advice.action];
  const isPositive = advice.action === "strongBuy" || advice.action === "buy";
  const isNegative = advice.action === "watch" || advice.action === "avoid";

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${advice.actionColor}40`,
        background: `${advice.actionColor}0d`,
        padding: 12,
      }}
    >
      {/* 头部：操作建议 */}
      <Flex align="center" gap={8} style={{ marginBottom: 8 }} wrap="wrap">
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            background: advice.actionColor,
            padding: "2px 10px",
            borderRadius: 9999,
          }}
        >
          {meta.label}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
          {advice.name} <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-tertiary)" }}>{advice.code}</span>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto", fontFamily: "monospace" }}>
          现价 ¥{advice.currentPrice.toFixed(2)}
        </span>
      </Flex>

      {/* 一句话结论 */}
      <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 10 }}>
        {advice.summary}
      </div>

      {/* 关键价位 */}
      <Flex gap={8} wrap="wrap" style={{ marginBottom: 10 }}>
        <PriceBlock
          icon={<RiseOutlined />} label="止盈价"
          value={advice.targetPrice}
          color="var(--red)"
          hint="达到目标价后可考虑分批止盈"
        />
        <PriceBlock
          icon={<FallOutlined />} label="止损价"
          value={advice.stopLossPrice}
          color="var(--green)"
          hint="跌破止损价建议离场，控制亏损"
        />
        <PriceBlock
          icon={<PlusCircleOutlined />} label="加仓价"
          value={advice.addMorePrice}
          color="var(--blue)"
          hint="回落到该价位附近可考虑加仓"
        />
        <PriceBlock
          icon={<MinusCircleOutlined />} label="减仓价"
          value={advice.reducePrice}
          color="var(--gold)"
          hint="涨到该价位附近可考虑部分减仓"
        />
      </Flex>

      {/* 数据摘要 */}
      <Flex gap={6} wrap="wrap" style={{ marginBottom: 10 }}>
        {advice.fairValue != null && (
          <Tag style={{ margin: 0, fontSize: 10 }}>合理估值 ¥{advice.fairValue.toFixed(1)}</Tag>
        )}
        {advice.pe != null && advice.pe > 0 && (
          <Tag style={{ margin: 0, fontSize: 10 }}>PE {advice.pe.toFixed(1)}</Tag>
        )}
        {advice.pePercentile5y != null && (
          <Tag
            style={{ margin: 0, fontSize: 10 }}
            color={advice.pePercentile5y < 20 ? "green" : advice.pePercentile5y > 80 ? "red" : "default"}
          >
            PE分位 {advice.pePercentile5y.toFixed(0)}%
          </Tag>
        )}
        {advice.dividendYield != null && (
          <Tag style={{ margin: 0, fontSize: 10 }} color={advice.dividendYield >= 5 ? "green" : "default"}>
            股息 {advice.dividendYield.toFixed(1)}%
          </Tag>
        )}
        {advice.compositeScore != null && (
          <Tag style={{ margin: 0, fontSize: 10 }} color={advice.compositeScore >= 70 ? "green" : advice.compositeScore >= 50 ? "blue" : "orange"}>
            评分 {advice.compositeScore}
          </Tag>
        )}
        {advice.safetyMargin != null && (
          <Tag style={{ margin: 0, fontSize: 10 }} color={advice.safetyMargin > 30 ? "green" : "default"}>
            安全边际 {advice.safetyMargin.toFixed(0)}%
          </Tag>
        )}
      </Flex>

      {/* 理由与风险 */}
      {(advice.reasons.length > 0 || advice.risks.length > 0) && (
        <div style={{ borderTop: "1px solid rgba(128,128,128,0.12)", paddingTop: 8 }}>
          {advice.reasons.map((r, i) => <Line key={`r${i}`} ok text={r} />)}
          {advice.risks.map((r, i) => <Line key={`k${i}`} ok={false} text={r} />)}
        </div>
      )}

      {/* 底部提示 */}
      <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
        <SafetyOutlined />
        建议基于估值模型与历史分位自动生成，仅供参考，不构成投资建议
      </div>
    </div>
  );
}
