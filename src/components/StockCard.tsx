// ============================================================
// StockCard.tsx — 单只股票的行情卡片（深色模式适配版）
// ============================================================

"use client";

import { useState, useMemo } from "react";
import { Card, Tag, Progress, Flex, Tooltip, Button } from "antd";
import {
  ArrowUpOutlined, ArrowDownOutlined,
  WarningOutlined, DownOutlined, UpOutlined,
} from "@ant-design/icons";
import type { StockData, AlertTrigger, InsiderTrade } from "@/lib/types";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";
import InsiderBadge from "./InsiderBadge";
import DividendBadge from "./DividendBadge";
import { priceColorFn, fearColor, fmt, fmtMoney } from "@/lib/format";

interface StockCardProps {
  data: StockData;
  alerts: AlertTrigger[];
  trades?: InsiderTrade[];
  dividend?: any;
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
        background: highlight ? "var(--alert-bg)" : "var(--hover-bg)",
        outline: highlight ? "1px solid var(--gold)" : undefined,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: highlight ? "var(--gold)" : "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );

  if (tooltip) {
    return <Tooltip title={tooltip} color="#27272a">{el}</Tooltip>;
  }
  return el;
}

export default function StockCard({ data, alerts, trades, dividend }: StockCardProps) {
  const { quote, fundamentals, safetyScore, fearGauge } = data;
  const isUp = quote.changePercent > 0;
  const isDown = quote.changePercent < 0;
  const hasAlerts = alerts.length > 0;
  const changeColor = priceColorFn(quote.changePercent);
  const [expanded, setExpanded] = useState(false);

  let borderColor = "var(--border-color)";
  if (hasAlerts) borderColor = "var(--gold)";
  else if (isUp) borderColor = "var(--red)";
  else if (isDown) borderColor = "var(--green)";

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
            background: "var(--gold)", color: "#fff",
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
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{quote.name}</span>
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
          } color="#27272a">
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
          {fmt(quote.currentPrice, 2)}
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
          value={fundamentals.eps != null ? fmtMoney(fundamentals.eps) : "--"}
        />
      </div>

      {/* 恐慌指数 */}
      {fearGauge && <FearGaugeBar fearGauge={fearGauge} />}

      {/* 成交信息 */}
      <Flex gap={4} style={{ marginTop: 10, fontSize: 12, color: "var(--text-tertiary)" }}>
        <span>成交量 {fundamentals.turnoverRate != null ? (fundamentals.turnoverRate > 100 ? (quote.volume / 1e4).toFixed(1) + "万" : quote.volume.toFixed(0)) : quote.volume.toFixed(0)}手</span>
        <span> · </span>
        <span>成交额 {fmtMoney(quote.amount / 1e8)}亿</span>
      </Flex>

      {/* 展开/折叠按钮 */}
      <Flex justify="center" style={{ marginTop: 8 }}>
        <Button
          type="text"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 11, color: "var(--text-tertiary)" }}
        >
          {expanded ? "收起" : "更多"}
        </Button>
      </Flex>

      {/* 展开详情 */}
      {expanded && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 10,
            borderTop: "1px solid var(--border-secondary)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>PE（市盈率）</div>
              <Flex align="center" gap={6}>
                <div style={{ width: 50, height: 5, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, (fundamentals.pe ?? 0) / 50 * 100)}%`,
                    height: "100%",
                    borderRadius: 3,
                    background: fundamentals.pe != null && fundamentals.pe < 10 ? "var(--green)" : fundamentals.pe != null && fundamentals.pe > 30 ? "var(--red)" : "var(--gold)",
                  }} />
                </div>
                <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>
                  {fundamentals.pe?.toFixed(1) ?? "--"}
                </span>
              </Flex>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>PB（市净率）</div>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: fundamentals.pb != null && fundamentals.pb < 1 ? "var(--green)" : "var(--text-primary)" }}>
                {fundamentals.pb?.toFixed(2) ?? "--"}
              </span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>总市值</div>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>
                {fundamentals.marketCap != null ? fundamentals.marketCap.toFixed(1) + "亿" : "--"}
              </span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>每股净资产</div>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>
                {fundamentals.bvps != null ? "¥" + fundamentals.bvps.toFixed(2) : "--"}
              </span>
            </div>
            {safetyScore && (
              <>
                <div style={{ gridColumn: "span 2" }}>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>安全边际</div>
                  <Flex gap={16}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>格雷厄姆</div>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: safetyScore.score != null && safetyScore.score >= 40 ? "var(--green)" : "var(--gold)" }}>
                        {safetyScore.score ?? "--"}分 · ¥{safetyScore.grahamNumber ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>ROE修正</div>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: safetyScore.roeScore != null && safetyScore.roeScore >= 40 ? "var(--green)" : "var(--gold)" }}>
                        {safetyScore.roeScore ?? "--"}分 · ¥{safetyScore.roeAdjustedValue ?? "--"}
                      </div>
                    </div>
                  </Flex>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── 恐惧指数条（子组件） ────────────────────────────────────

function FearGaugeBar({ fearGauge }: { fearGauge: { overall: number; label: string; drawdown: number; rsi: number; macd: number } }) {
  const fc = fearColor(fearGauge.overall);
  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 6,
        padding: "8px 10px",
        background: fc.bg,
        border: `1px solid ${fc.bar}`,
      }}
    >
      <Flex align="center" justify="space-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: fc.text }}>
          {fearGauge.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          涨跌{fearGauge.drawdown} · 波动{fearGauge.rsi} · 换手{fearGauge.macd}
        </span>
      </Flex>
      <Progress
        percent={fearGauge.overall}
        size="small"
        showInfo={false}
        strokeColor={fc.bar}
        trailColor="var(--border-secondary)"
      />
    </div>
  );
}
