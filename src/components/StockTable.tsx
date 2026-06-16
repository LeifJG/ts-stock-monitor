// ============================================================
// StockTable.tsx — 股票数据表格视图（antd Table）
// ============================================================

"use client";

import { useState, useMemo } from "react";
import { Table, Input, Tooltip, Tag } from "antd";
import { SearchOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { StockData, AlertTrigger, SortField, SortOrder, InsiderTrade } from "@/lib/types";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";
import InsiderBadge from "./InsiderBadge";
import DividendBadge from "./DividendBadge";

// ─── 列头帮助气泡内容 ─────────────────────────────────────────

const COL_HELP: Record<string, { formula: string; meaning: string }> = {
  pe: { formula: "股价 ÷ 每股收益", meaning: "按当前利润，买一股多少年回本。越低越便宜，<10 低估，>50 高估。亏损股为负数。" },
  pb: { formula: "股价 ÷ 每股净资产", meaning: "股价是净资产的多少倍。<1 为破净（折价），>5 说明市场愿意为品牌/技术付溢价。" },
  marketCap: { formula: "股价 × 总股本", meaning: "公司全部股票的总价值。大市值 = 大盘股，波动相对小。单位：亿元。" },
  dividendYield: { formula: "每股分红 ÷ 股价 × 100%", meaning: "买入后每年能拿回多少现金股息。>5% 算高股息，>8% 需警惕是否可持续。" },
  turnoverRate: { formula: "成交量 ÷ 流通股本 × 100%", meaning: "一天内多少人买卖。>5% 活跃，>10% 过热（可能是出货）。<0.5% 冷门。" },
  roe: { formula: "PB ÷ PE × 100%（或 净利润÷净资产）", meaning: "每 1 元净资产每年能赚多少利润。>20% 优秀，>15% 良好，<5% 低于理财。" },
  dividendPayoutRatio: { formula: "每股分红 ÷ 每股收益 × 100%", meaning: "利润里拿出多少来分红。<30% 偏保守，30-60% 健康，>100% 不可持续（吃老本）。" },
  debtRatio: { formula: "总负债 ÷ 总资产 × 100%", meaning: "公司资产有多少是借来的。<50% 稳健，50-70% 正常，>70% 高杠杆需警惕。银行股除外。" },
  fearIndex: { formula: "涨跌幅×35% + 振幅×35% + 换手率×30%", meaning: "综合恐慌指数 0-100。>60 恐慌（或抄底机会），<40 贪婪（或追高风险）。" },
  safetyScore: { formula: "(格雷厄姆估值 - 现价) ÷ 估值 × 100%", meaning: "安全边际 0-100。>60 被低估，40-60 合理偏低，<20 高估/危险。基于格雷厄姆公式。" },
};

// ─── 帮助气泡包装 ─────────────────────────────────────────────

function ColLabel({ field, label }: { field: string; label: string }) {
  const help = COL_HELP[field];
  if (!help) return <>{label}</>;
  return (
    <Tooltip
      title={
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>公式</div>
          <div style={{ background: "rgba(59,130,246,0.3)", borderRadius: 4, padding: "2px 8px", fontFamily: "monospace", fontSize: 11, color: "#93c5fd", marginBottom: 8 }}>{help.formula}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>含义</div>
          <p style={{ fontSize: 11, color: "#d1d5db", margin: 0, lineHeight: 1.6 }}>{help.meaning}</p>
        </div>
      }
      placement="top"
      color="#1f2937"
      styles={{ container: { minWidth: 220, padding: "10px 12px" } }}
    >
      <span style={{ borderBottom: "1px dashed #d1d5db", cursor: "help" }}>{label}</span>
    </Tooltip>
  );
}

// ─── 格式化 ─────────────────────────────────────────────────────

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null) return "--";
  return v.toFixed(digits);
}

// ─── 异常样式 ──────────────────────────────────────────────────

function priceColor(pct: number): string {
  if (pct > 9.5) return "#dc2626";
  if (pct < -9.5) return "#16a34a";
  if (pct > 5) return "#ef4444";
  if (pct < -5) return "#22c55e";
  if (pct > 0) return "#ef4444";
  if (pct < 0) return "#22c55e";
  return "#9ca3af";
}

// ─── 组件 ─────────────────────────────────────────────────────

interface StockTableProps {
  data: StockData[];
  triggers: AlertTrigger[];
  loading: boolean;
  error: string | null;
  insiderTrades: Map<string, InsiderTrade[]>;
  dividendHistory: Map<string, any>;
}

export default function StockTable({ data, triggers, loading, error, insiderTrades, dividendHistory }: StockTableProps) {
  const [filterText, setFilterText] = useState("");

  const triggeredCodes = useMemo(() => new Set(triggers.map((t) => t.stockCode)), [triggers]);

  const filtered = useMemo(() => {
    if (!filterText.trim()) return data;
    const kw = filterText.trim().toLowerCase();
    return data.filter(
      (s) => s.quote.code.includes(kw) || s.quote.name.toLowerCase().includes(kw)
    );
  }, [data, filterText]);

  if (error) {
    return (
      <div style={{ borderRadius: 12, border: "1px solid #fecaca", background: "#fef2f2", padding: 24, textAlign: "center", color: "#dc2626", fontSize: 14 }}>
        {error}
      </div>
    );
  }

  const columns: ColumnsType<StockData> = [
    {
      title: "代码", dataIndex: ["quote", "code"], key: "code",
      sorter: (a, b) => parseInt(a.quote.code) - parseInt(b.quote.code),
      width: 80,
      render: (code: string) => <span style={{ fontFamily: "monospace", color: "#6b7280" }}>{code}</span>,
    },
    {
      title: "名称", dataIndex: ["quote", "name"], key: "name",
      width: 100,
      sorter: (a, b) => a.quote.name.localeCompare(b.quote.name),
      render: (name: string, record) => {
        const hasAlert = triggeredCodes.has(record.quote.code);
        return (
          <span style={{ fontWeight: 500, color: hasAlert ? "#d97706" : "#111827" }}>
            {hasAlert && <span style={{ marginRight: 4 }}>🔔</span>}
            {name}
          </span>
        );
      },
    },
    {
      title: "现价", dataIndex: ["quote", "currentPrice"], key: "currentPrice",
      sorter: (a, b) => a.quote.currentPrice - b.quote.currentPrice,
      width: 80,
      render: (v: number) => <span style={{ fontFamily: "monospace" }}>{fmt(v, 2)}</span>,
    },
    {
      title: <span style={{ color: priceColor(10) }}>涨跌幅</span>,
      key: "changePercent",
      sorter: (a, b) => a.quote.changePercent - b.quote.changePercent,
      width: 85,
      render: (_, record) => {
        const pct = record.quote.changePercent;
        return (
          <span style={{ fontFamily: "monospace", color: priceColor(pct), fontWeight: Math.abs(pct) > 5 ? 700 : 400 }}>
            {pct > 0 ? "+" : ""}{fmt(pct, 2)}%
          </span>
        );
      },
    },

    {
      title: <ColLabel field="dividendYield" label="股息率" />,
      key: "dividendYield",
      sorter: (a, b) => (a.fundamentals.dividendYield ?? -999) - (b.fundamentals.dividendYield ?? -999),
      width: 85,
      render: (_, r) => {
        const v = r.fundamentals.dividendYield;
        const isHigh = v != null && v > 5;
        return <span style={{ fontFamily: "monospace", color: isHigh ? "#16a34a" : undefined, fontWeight: isHigh ? 700 : 400 }}>{fmt(v, 2)}%</span>;
      },
    },
    {
      title: "分红历史",
      key: "dividendHistory",
      width: 110,
      render: (_, r) => <DividendBadge data={dividendHistory.get(r.quote.code)} />,
    },
    {
      title: <ColLabel field="turnoverRate" label="换手率" />,
      key: "turnoverRate",
      sorter: (a, b) => (a.fundamentals.turnoverRate ?? -999) - (b.fundamentals.turnoverRate ?? -999),
      width: 85,
      render: (_, r) => {
        const v = r.fundamentals.turnoverRate;
        const col = v != null && v > 10 ? "#ea580c" : v != null && v > 5 ? "#f97316" : undefined;
        return <span style={{ fontFamily: "monospace", color: col, fontWeight: v != null && v > 10 ? 700 : 400 }}>{fmt(v, 2)}%</span>;
      },
    },
    {
      title: <ColLabel field="roe" label="ROE" />,
      key: "roe",
      sorter: (a, b) => (a.fundamentals.roe ?? -999) - (b.fundamentals.roe ?? -999),
      width: 75,
      render: (_, r) => {
        const v = r.fundamentals.roe;
        return <span style={{ fontFamily: "monospace", color: v != null && v > 20 ? "#16a34a" : undefined, fontWeight: v != null && v > 20 ? 700 : 400 }}>{fmt(v, 1)}%</span>;
      },
    },
    {
      title: <ColLabel field="dividendPayoutRatio" label="支付率" />,
      key: "dividendPayoutRatio",
      sorter: (a, b) => (a.fundamentals.dividendPayoutRatio ?? -999) - (b.fundamentals.dividendPayoutRatio ?? -999),
      width: 80,
      render: (_, r) => {
        const v = r.fundamentals.dividendPayoutRatio;
        const col = v != null && v > 100 ? "#ef4444" : v != null && v < 30 ? "#eab308" : undefined;
        return <span style={{ fontFamily: "monospace", color: col, fontWeight: v != null && v > 100 ? 700 : 400 }}>{fmt(v, 1)}%</span>;
      },
    },
    {
      title: <ColLabel field="debtRatio" label="负债率" />,
      key: "debtRatio",
      sorter: (a, b) => (a.fundamentals.debtRatio ?? -999) - (b.fundamentals.debtRatio ?? -999),
      width: 80,
      render: (_, r) => {
        const v = r.fundamentals.debtRatio;
        const col = v != null && v > 70 ? "#ef4444" : v != null && v > 50 ? "#f97316" : undefined;
        return <span style={{ fontFamily: "monospace", color: col, fontWeight: v != null && v > 70 ? 700 : 400 }}>{fmt(v, 1)}%</span>;
      },
    },
    {
      title: <ColLabel field="fearIndex" label="恐慌" />,
      key: "fearIndex",
      sorter: (a, b) => (a.fearGauge?.overall ?? -1) - (b.fearGauge?.overall ?? -1),
      width: 60,
      render: (_, r) => {
        const v = r.fearGauge?.overall;
        return <span style={{ fontFamily: "monospace", color: v != null ? (v < 40 ? "#22c55e" : v < 60 ? "#eab308" : "#ef4444") : undefined }}>{v ?? "--"}</span>;
      },
    },
    {
      title: <ColLabel field="safetyScore" label="安全" />,
      key: "safetyScore",
      sorter: (a, b) => ((a.safetyScore?.score ?? -1) - (b.safetyScore?.score ?? -1)) || ((a.safetyScore?.roeScore ?? -1) - (b.safetyScore?.roeScore ?? -1)),
      width: 85,
      render: (_, r) => {
        const s = r.safetyScore;
        const v = s?.score;
        const rv = s?.roeScore;
        const col = v != null ? (v >= 70 ? "#16a34a" : v >= 40 ? "#2563eb" : v >= 10 ? "#eab308" : "#dc2626") : undefined;
        const rCol = rv != null ? (rv >= 70 ? "#16a34a" : rv >= 40 ? "#2563eb" : rv >= 10 ? "#eab308" : "#dc2626") : undefined;
        return (
          <Tooltip title={
            <div style={{ fontSize: 11, lineHeight: 1.8 }}>
              <div><strong>格雷厄姆（保守）</strong></div>
              <div>估值 ¥{s?.grahamNumber ?? "--"} · 安全边际 {s?.marginOfSafety != null ? s.marginOfSafety.toFixed(1) + "%" : "--"}</div>
              <div style={{ marginTop: 4 }}><strong>ROE修正（合理）</strong></div>
              <div>估值 ¥{s?.roeAdjustedValue ?? "--"} · 安全边际 {s?.roeMarginOfSafety != null ? s.roeMarginOfSafety.toFixed(1) + "%" : "--"}</div>
            </div>
          } color="#1f2937">
            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, cursor: "help" }}>
              <span style={{ color: col }}>{v ?? "--"}</span>
              <span style={{ color: "#9ca3af", margin: "0 2px" }}>|</span>
              <span style={{ color: rCol }}>{rv ?? "--"}</span>
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "增减持",
      key: "insider",
      width: 90,
      render: (_, r) => <InsiderBadge trades={insiderTrades.get(r.quote.code)} />,
    },
  ];

  return (
    <div>
      {/* 筛选栏 */}
      <div style={{ marginBottom: 12 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#9ca3af" }} />}
          placeholder="筛选代码或名称..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ width: 200 }}
          size="small"
          allowClear
        />
        <span style={{ marginLeft: 8, fontSize: 12, color: "#9ca3af" }}>
          {filtered.length} / {data.length} 只
        </span>
      </div>

      {/* 表格 */}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(r) => r.quote.code}
        loading={loading && data.length === 0}
        size="small"
        pagination={false}
        style={{ fontSize: 12 }}
        rowClassName={(record) => {
          const hasAlert = triggeredCodes.has(record.quote.code);
          return hasAlert ? "ant-table-row-alert" : "";
        }}
      />
    </div>
  );
}
