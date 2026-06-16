// ============================================================
// StockCard.tsx — 单只股票的行情卡片
// ============================================================

"use client";

import { Card, Tag, Progress, Flex, Tooltip } from "antd";
import {
  ArrowUpOutlined, ArrowDownOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { StockData, AlertTrigger, InsiderTrade } from "@/lib/types";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";
import InsiderBadge from "./InsiderBadge";
import DividendBadge from "./DividendBadge";

interface StockCardProps {
  data: StockData;
  alerts: AlertTrigger[];
  trades?: InsiderTrade[];
  dividend?: any;
}

function formatPrice(v: number): string {
  return v.toFixed(2);
}

function formatLarge(v: number | null, digits = 2): string {
  if (v === null) return "--";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function MetricItem({ label, value, highlight, tooltip }: {
  label: string;
  value: string;
  highlight?: boolean;
  tooltip?: string;
}) {
  const el = (
    <div
      style={{
        borderRadius: 6,
        padding: "4px 8px",
        background: highlight ? "#fef3c7" : "#f9fafb",
        outline: highlight ? "1px solid #fcd34d" : undefined,
      }}
    >
      <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: highlight ? "#d97706" : "#374151" }}>
        {value}
      </div>
    </div>
  );

  if (tooltip) {
    return <Tooltip title={tooltip}>{el}</Tooltip>;
  }
  return el;
}

export default function StockCard({ data, alerts, trades, dividend }: StockCardProps) {
  const { quote, fundamentals, safetyScore, fearGauge } = data;
  const isUp = quote.changePercent > 0;
  const isDown = quote.changePercent < 0;
  const hasAlerts = alerts.length > 0;
  const changeColor = isUp ? "#ef4444" : isDown ? "#22c55e" : "#9ca3af";

  let borderColor = "#e5e7eb";
  if (hasAlerts) borderColor = "#fbbf24";
  else if (isUp) borderColor = "#fecaca";
  else if (isDown) borderColor = "#bbf7d0";

  return (
    <Card
      size="small"
      style={{ borderColor, borderWidth: hasAlerts ? 2 : 1, position: "relative" }}
      styles={{ body: { padding: 14 } }}
    >
      {/* 告警标记 */}
      {hasAlerts && (
        <div
          style={{
            position: "absolute", top: -10, right: -10,
            background: "#fbbf24", color: "#fff",
            borderRadius: 20, padding: "2px 10px",
            fontSize: 12, fontWeight: 700,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
        >
          <WarningOutlined style={{ marginRight: 4 }} />
          {alerts.length}
        </div>
      )}

      {/* 头部：名称 + 代码 + 安全评分 */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
        <Flex align="center" gap={8}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{quote.name}</span>
          <Tag style={{ margin: 0, fontFamily: "monospace" }}>{quote.code}</Tag>
        </Flex>
        {safetyScore?.grade && safetyScore.score != null && (
          <Tag color={safetyScore.score >= 60 ? "green" : safetyScore.score >= 30 ? "blue" : "red"}>
            {safetyScore.grade} · {safetyScore.score}
          </Tag>
        )}
        {safetyScore?.roeScore != null && (
          <Tooltip title={
            <div style={{ fontSize: 11, lineHeight: 1.8 }}>
              <div><strong>格雷厄姆（保守）</strong> {safetyScore.score}分 · 估值 ¥{safetyScore.grahamNumber}</div>
              <div style={{ marginTop: 4 }}><strong>ROE修正（合理）</strong> {safetyScore.roeScore}分 · 估值 ¥{safetyScore.roeAdjustedValue}</div>
            </div>
          } color="#1f2937">
            <Tag color={safetyScore.roeScore >= 60 ? "green" : safetyScore.roeScore >= 30 ? "blue" : "red"}
              style={{ cursor: "help" }}>
              {safetyScore.roeGrade} · {safetyScore.roeScore}
            </Tag>
          </Tooltip>
        )}
        {trades && trades.length > 0 && <InsiderBadge trades={trades} />}
        {dividend && <DividendBadge data={dividend} />}
      </Flex>

      {/* 价格区域 */}
      <Flex align="baseline" gap={12} style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: changeColor }}>
          {formatPrice(quote.currentPrice)}
        </span>
        <span style={{ fontSize: 15, fontWeight: 500, color: changeColor }}>
          {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
        </span>
        <span style={{ fontSize: 13, color: changeColor }}>
          {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
        </span>
      </Flex>

      {/* 指标网格 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>

        <MetricItem
          label="股息率"
          value={fundamentals.dividendYield != null ? fundamentals.dividendYield.toFixed(2) + "%" : "--"}
          highlight={alerts.some((a) => a.field === "dividendYield")}
          tooltip="每股分红÷股价，>5%高股息"
        />
        <MetricItem
          label="换手率"
          value={fundamentals.turnoverRate != null ? fundamentals.turnoverRate.toFixed(2) + "%" : "--"}
          tooltip="成交量÷流通股本，>10%过热"
        />
        <MetricItem
          label="ROE"
          value={fundamentals.roe != null ? fundamentals.roe.toFixed(1) + "%" : "--"}
          highlight={fundamentals.roe != null && fundamentals.roe > 20}
          tooltip="PB÷PE，每元净资产赚多少利润"
        />
        <MetricItem
          label="股息支付率"
          value={fundamentals.dividendPayoutRatio != null ? fundamentals.dividendPayoutRatio.toFixed(1) + "%" : "--"}
          highlight={fundamentals.dividendPayoutRatio != null && fundamentals.dividendPayoutRatio > 100}
          tooltip="每股分红÷每股收益，>100%不可持续"
        />
        <MetricItem
          label="负债率"
          value={fundamentals.debtRatio != null ? fundamentals.debtRatio.toFixed(1) + "%" : "--"}
          highlight={fundamentals.debtRatio != null && fundamentals.debtRatio > 70}
          tooltip="总负债÷总资产，>70%高杠杆"
        />
        <MetricItem
          label="每股收益"
          value={fundamentals.eps != null ? formatLarge(fundamentals.eps, 3) : "--"}
        />
      </div>

      {/* 恐慌指数 */}
      {fearGauge && (
        <div
          style={{
            marginTop: 10,
            borderRadius: 6,
            padding: "8px 10px",
            background: fearGauge.overall < 40 ? "#f0fdf4" : fearGauge.overall < 60 ? "#fefce8" : "#fef2f2",
            border: `1px solid ${fearGauge.overall < 40 ? "#bbf7d0" : fearGauge.overall < 60 ? "#fde68a" : "#fecaca"}`,
          }}
        >
          <Flex align="center" justify="space-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: fearGauge.overall < 40 ? "#22c55e" : fearGauge.overall < 60 ? "#eab308" : "#ef4444" }}>
              {fearGauge.label}
            </span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              涨跌{fearGauge.drawdown} · 波动{fearGauge.rsi} · 换手{fearGauge.macd}
            </span>
          </Flex>
          <Progress
            percent={fearGauge.overall}
            size="small"
            showInfo={false}
            strokeColor={fearGauge.overall < 40 ? "#22c55e" : fearGauge.overall < 60 ? "#eab308" : "#ef4444"}
            trailColor="#e5e7eb"
          />
        </div>
      )}

      {/* 成交信息 */}
      <Flex gap={4} style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>
        <span>成交量 {fundamentals.turnoverRate != null ? (fundamentals.turnoverRate > 100 ? (quote.volume / 1e4).toFixed(1) + "万" : quote.volume.toFixed(0)) : quote.volume.toFixed(0)}手</span>
        <span> · </span>
        <span>成交额 {formatLarge(quote.amount / 1e8, 2)}亿</span>
      </Flex>
    </Card>
  );
}
