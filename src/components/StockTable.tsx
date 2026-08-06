// ============================================================
// StockTable.tsx — 股票数据表格视图（antd Table）
// ============================================================

"use client";

import { useState, useMemo } from "react";
import { Table, Input, Tooltip, Tag, Flex } from "antd";
import { SearchOutlined, ArrowUpOutlined, ArrowDownOutlined, StarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { StockData, AlertTrigger, SortField, SortOrder, InsiderTrade } from "@/lib/types";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";
import InsiderBadge from "./InsiderBadge";
import DividendBadge from "./DividendBadge";
import { PEBadge, DividendYieldBadge, ROEBadge, SafetyBadge } from "./MetricBadges";
import { fmt } from "@/lib/format";
import type { ScoreResult } from "@/lib/scorer";
import type { ValuationData } from "@/app/api/valuation/route";
import ShareholderTrend from "./ShareholderTrend";
import ValuationBadge from "./ValuationBadge";
import ValuationPanel from "./ValuationPanel";

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
  fcfToNetProfit: { formula: "经营性现金流净额 ÷ 净利润", meaning: "利润有没有真金白银支撑。>1 说明赚的是真钱（盈利质量好），0.5-1 正常，<0.5 警惕应收账款/存货积压。" },
  roic: { formula: "税后营业利润 ÷ 投入资本 × 100%", meaning: "公司每投入一元资本能赚多少钱。比 ROE 更能衡量管理层能力（去杠杆影响）。>20% 优质，10-20% 良好，<5% 不佳。" },
  grossMargin: { formula: "(营业收入 - 营业成本) ÷ 营业收入 × 100%", meaning: "每卖一元钱能赚多少毛利。高且稳定=护城河深。逐年下滑是危险信号。" },
  fearIndex: { formula: "涨跌幅×35% + 振幅×35% + 换手率×30%", meaning: "综合恐慌指数 0-100。>60 恐慌（或抄底机会），<40 贪婪（或追高风险）。" },
  safetyScore: { formula: "(格雷厄姆估值 - 现价) ÷ 估值 × 100%", meaning: "安全边际 0-100。>60 被低估，40-60 合理偏低，<20 高估/危险。基于格雷厄姆公式。" },
  valuation: { formula: "当前PE/PB ÷ 历史5年PE/PB区间 → 百分位", meaning: "当前估值在近5年历史中处于什么位置。<20% 低估（绿），20-50% 偏低（蓝），50-80% 偏高（金），>80% 高估（红）。分位越低越便宜。" },
};

// ─── 帮助气泡包装 ─────────────────────────────────────────────

function ColLabel({ field, label }: { field: string; label: string }) {
  const help = COL_HELP[field];
  if (!help) return <>{label}</>;
  return (
    <Tooltip
      title={
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>公式</div>
          <div style={{ background: "rgba(59,130,246,0.3)", borderRadius: 4, padding: "2px 8px", fontFamily: "monospace", fontSize: 11, color: "#93c5fd", marginBottom: 8 }}>{help.formula}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>含义</div>
          <p style={{ fontSize: 11, color: "#d1d5db", margin: 0, lineHeight: 1.6 }}>{help.meaning}</p>
        </div>
      }
      placement="top"
      color="#27272a"
      styles={{ container: { minWidth: 220, padding: "10px 12px" } }}
    >
      <span style={{ borderBottom: "1px dashed var(--border-color)", cursor: "help", color: "var(--text-secondary)" }}>{label}</span>
    </Tooltip>
  );
}

// ─── 异常样式 ──────────────────────────────────────────────────

function priceColor(pct: number): string {
  if (pct > 0) return "var(--red)";
  if (pct < 0) return "var(--green)";
  return "var(--text-tertiary)";
}

// ─── 组件 ─────────────────────────────────────────────────────

interface StockTableProps {
  data: StockData[];
  triggers: AlertTrigger[];
  loading: boolean;
  error: string | null;
  insiderTrades: Map<string, InsiderTrade[]>;
  dividendHistory: Map<string, any>;
  valuationData?: Map<string, ValuationData>;
  scores?: Map<string, ScoreResult>;
  showScore?: boolean;
  onToggleScore?: () => void;
}

export default function StockTable({ data, triggers, loading, error, insiderTrades, dividendHistory, valuationData, scores, showScore, onToggleScore }: StockTableProps) {
  const [filterText, setFilterText] = useState("");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

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
      <div style={{ borderRadius: 12, border: "1px solid var(--red)", background: "var(--alert-bg)", padding: 24, textAlign: "center", color: "var(--red)", fontSize: 14 }}>
        {error}
      </div>
    );
  }

  const columns: ColumnsType<StockData> = [
    {
      title: "代码", dataIndex: ["quote", "code"], key: "code",
      sorter: (a, b) => parseInt(a.quote.code) - parseInt(b.quote.code),
      width: 64,
      render: (code: string) => <span style={{ fontFamily: "monospace", color: "var(--text-tertiary)", fontSize: 11 }}>{code}</span>,
    },
    // ── 综合评分列（条件显示） ──────────────────────────────
    ...(showScore && scores ? [{
      title: (
        <Tooltip title={
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            <div>股息率 25% + ROE 20% + 安全边际 25%</div>
            <div>PE 20% + 负债率 10%（越低越好）</div>
            <div style={{ marginTop: 4, color: "#a1a1aa" }}>← 旧版权重（新版含 FCF/ROIC/毛利率）</div>
          </div>
        } color="#27272a">
          <span style={{ borderBottom: "1px dashed var(--border-color)", cursor: "help" }}>
            ⭐ 评分
          </span>
        </Tooltip>
      ),
      key: "compositeScore",
      width: 70,
      sorter: (a: StockData, b: StockData) => {
        const sa = scores.get(a.quote.code)?.total ?? 0;
        const sb = scores.get(b.quote.code)?.total ?? 0;
        return sa - sb;
      },
      render: (_: any, record: StockData) => {
        const s = scores.get(record.quote.code);
        if (!s) return <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>--</span>;
        const color = s.total >= 70 ? "var(--green)" : s.total >= 50 ? "var(--gold)" : "var(--red)";
        const bg = s.total >= 70 ? "rgba(34,197,94,0.12)" : s.total >= 50 ? "rgba(217,119,6,0.12)" : "rgba(239,68,68,0.12)";
        return (
          <Tooltip title={
            <div style={{ fontSize: 11, lineHeight: 1.8 }}>
              <div>股息率 {s.breakdown.dividendYield}分 · ROE {s.breakdown.roe}分</div>
              <div>安全 {s.breakdown.safety}分 · PE {s.breakdown.pe}分</div>
              <div>负债率 {s.breakdown.debtRatio}分 · FCF/净利 {s.breakdown.fcfToNetProfit}分</div>
              <div>ROIC {s.breakdown.roic}分 · 毛利率 {s.breakdown.grossMargin}分</div>
            </div>
          } color="#27272a">
            <div style={{
              width: 26, height: 26, borderRadius: 6, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: bg, color, fontWeight: 700, fontSize: 12, cursor: "help",
            }}>
              {s.total}
            </div>
          </Tooltip>
        );
      },
    }] as ColumnsType<StockData> : []),
    {
      title: "名称", dataIndex: ["quote", "name"], key: "name",
      width: 88,
      sorter: (a, b) => a.quote.name.localeCompare(b.quote.name),
      render: (name: string, record) => {
        const hasAlert = triggeredCodes.has(record.quote.code);
        return (
          <span style={{ fontWeight: 500, color: hasAlert ? "var(--gold)" : "var(--text-primary)", fontSize: 12 }}>
            {hasAlert && <span style={{ marginRight: 3 }}>🔔</span>}
            {name}
          </span>
        );
      },
    },
    {
      title: "现价", dataIndex: ["quote", "currentPrice"], key: "currentPrice",
      sorter: (a, b) => a.quote.currentPrice - b.quote.currentPrice,
      width: 66,
      render: (v: number) => <span style={{ fontFamily: "monospace", color: "var(--text-primary)", fontSize: 12 }}>{fmt(v, 2)}</span>,
    },
    {
      title: "涨跌",
      key: "changePercent",
      sorter: (a, b) => a.quote.changePercent - b.quote.changePercent,
      width: 68,
      render: (_, record) => {
        const pct = record.quote.changePercent;
        return (
          <span style={{ fontFamily: "monospace", color: priceColor(pct), fontSize: 12, fontWeight: Math.abs(pct) > 5 ? 700 : 400 }}>
            {pct > 0 ? "+" : ""}{fmt(pct, 2)}%
          </span>
        );
      },
    },

    // ── 估值组 ───────────────────────────────────────────────
    {
      title: <span style={{ fontSize: 11, fontWeight: 600 }}>📐 估值</span>,
      key: "group-valuation",
      children: [
        {
          title: <ColLabel field="pe" label="PE" />,
          key: "pe",
          sorter: (a, b) => (a.fundamentals.pe ?? 999) - (b.fundamentals.pe ?? 999),
          width: 80,
          render: (_, r) => <PEBadge pe={r.fundamentals.pe} />,
        },
        {
          title: <ColLabel field="pb" label="PB" />,
          key: "pb",
          sorter: (a, b) => (a.fundamentals.pb ?? 999) - (b.fundamentals.pb ?? 999),
          width: 70,
          render: (_, r) => {
            const pb = r.fundamentals.pb;
            const col = pb != null ? (pb < 1 ? "var(--green)" : pb < 3 ? "var(--blue)" : pb < 5 ? "var(--gold)" : "var(--red)") : undefined;
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: pb != null && pb < 1 ? 700 : 400 }}>{pb?.toFixed(2) ?? "--"}</span>;
          },
        },
        {
          title: <ColLabel field="valuation" label="估值分位" />,
          key: "valuation",
          width: 148,
          render: (_, r) => (
            <ValuationBadge valuation={valuationData?.get(r.quote.code)} />
          ),
        },
      ],
    },

    // ── 分红组 ───────────────────────────────────────────────
    {
      title: <span style={{ fontSize: 11, fontWeight: 600 }}>💰 分红</span>,
      key: "group-dividend",
      children: [
        {
          title: <ColLabel field="dividendYield" label="股息率" />,
          key: "dividendYield",
          sorter: (a, b) => (a.fundamentals.dividendYield ?? -999) - (b.fundamentals.dividendYield ?? -999),
          width: 80,
          render: (_, r) => <DividendYieldBadge value={r.fundamentals.dividendYield} />,
        },
        {
          title: "分红历史",
          key: "dividendHistory",
          width: 86,
          render: (_, r) => <DividendBadge data={dividendHistory.get(r.quote.code)} />,
        },
        {
          title: <ColLabel field="dividendPayoutRatio" label="支付率" />,
          key: "dividendPayoutRatio",
          sorter: (a, b) => (a.fundamentals.dividendPayoutRatio ?? -999) - (b.fundamentals.dividendPayoutRatio ?? -999),
          width: 62,
          render: (_, r) => {
            const v = r.fundamentals.dividendPayoutRatio;
            const col = v != null && v > 100 ? "var(--red)" : v != null && v < 30 ? "var(--gold)" : undefined;
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: v != null && v > 100 ? 700 : 400 }}>{fmt(v, 0)}%</span>;
          },
        },
      ],
    },

    // ── 质量组 ───────────────────────────────────────────────
    {
      title: <span style={{ fontSize: 11, fontWeight: 600 }}>💎 质量</span>,
      key: "group-quality",
      children: [
        {
          title: <ColLabel field="roe" label="ROE" />,
          key: "roe",
          sorter: (a, b) => (a.fundamentals.roe ?? -999) - (b.fundamentals.roe ?? -999),
          width: 80,
          render: (_, r) => <ROEBadge roe={r.fundamentals.roe} />,
        },
        {
          title: <ColLabel field="roic" label="ROIC" />,
          key: "roic",
          sorter: (a, b) => (a.fundamentals.roic ?? -999) - (b.fundamentals.roic ?? -999),
          width: 70,
          render: (_, r) => {
            const v = r.fundamentals.roic;
            if (v == null) return <span style={{ fontFamily: "monospace", color: "var(--text-tertiary)", fontSize: 12 }}>--</span>;
            const col = v >= 20 ? "var(--green)" : v >= 10 ? "var(--blue)" : v >= 5 ? "var(--gold)" : "var(--red)";
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: v >= 20 ? 700 : 400 }}>{fmt(v, 1)}%</span>;
          },
        },
        {
          title: <ColLabel field="fcfToNetProfit" label="FCF/净利" />,
          key: "fcfToNetProfit",
          sorter: (a, b) => (a.fundamentals.fcfToNetProfit ?? -999) - (b.fundamentals.fcfToNetProfit ?? -999),
          width: 76,
          render: (_, r) => {
            const v = r.fundamentals.fcfToNetProfit;
            if (v == null) return <span style={{ fontFamily: "monospace", color: "var(--text-tertiary)", fontSize: 12 }}>--</span>;
            const col = v >= 1.2 ? "var(--green)" : v >= 0.7 ? "var(--gold)" : "var(--red)";
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: v >= 1.2 ? 700 : 400 }}>{fmt(v, 2)}</span>;
          },
        },
        {
          title: <ColLabel field="grossMargin" label="毛利率" />,
          key: "grossMargin",
          sorter: (a, b) => (a.fundamentals.grossMargin ?? -999) - (b.fundamentals.grossMargin ?? -999),
          width: 76,
          render: (_, r) => {
            const v = r.fundamentals.grossMargin;
            const trend = r.fundamentals.grossMarginTrend;
            if (v == null) return <span style={{ fontFamily: "monospace", color: "var(--text-tertiary)", fontSize: 12 }}>--</span>;
            const col = v >= 60 ? "var(--green)" : v >= 30 ? "var(--blue)" : v >= 15 ? "var(--gold)" : "var(--red)";
            const trendIcon = trend === 1 ? "↑" : trend === -1 ? "↓" : "";
            const trendCol = trend === 1 ? "var(--green)" : trend === -1 ? "var(--red)" : undefined;
            return (
              <span style={{ fontFamily: "monospace", color: col, fontSize: 12 }}>
                {fmt(v, 1)}%
                {trendIcon && <span style={{ color: trendCol, fontSize: 9, marginLeft: 1 }}>{trendIcon}</span>}
              </span>
            );
          },
        },
      ],
    },

    // ── 风险组 ───────────────────────────────────────────────
    {
      title: <span style={{ fontSize: 11, fontWeight: 600 }}>⚠️ 风险</span>,
      key: "group-risk",
      children: [
        {
          title: <ColLabel field="debtRatio" label="负债率" />,
          key: "debtRatio",
          sorter: (a, b) => (a.fundamentals.debtRatio ?? -999) - (b.fundamentals.debtRatio ?? -999),
          width: 68,
          render: (_, r) => {
            const v = r.fundamentals.debtRatio;
            const col = v != null && v > 70 ? "var(--red)" : v != null && v > 50 ? "var(--gold)" : undefined;
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: v != null && v > 70 ? 700 : 400 }}>{fmt(v, 0)}%</span>;
          },
        },
        {
          title: <ColLabel field="fearIndex" label="恐慌" />,
          key: "fearIndex",
          sorter: (a, b) => (a.fearGauge?.overall ?? -1) - (b.fearGauge?.overall ?? -1),
          width: 52,
          render: (_, r) => {
            const v = r.fearGauge?.overall;
            const col = v != null ? (v < 40 ? "var(--green)" : v < 60 ? "var(--gold)" : "var(--red)") : undefined;
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12 }}>{v ?? "--"}</span>;
          },
        },
        {
          title: <ColLabel field="safetyScore" label="安全" />,
          key: "safetyScore",
          sorter: (a, b) => ((a.safetyScore?.score ?? -1) - (b.safetyScore?.score ?? -1)) || ((a.safetyScore?.roeScore ?? -1) - (b.safetyScore?.roeScore ?? -1)),
          width: 130,
          render: (_, r) => <SafetyBadge score={r.safetyScore?.score} />,
        },
      ],
    },

    // ── 交易组 ───────────────────────────────────────────────
    {
      title: <span style={{ fontSize: 11, fontWeight: 600 }}>🔄 交易</span>,
      key: "group-trade",
      children: [
        {
          title: <ColLabel field="turnoverRate" label="换手" />,
          key: "turnoverRate",
          sorter: (a, b) => (a.fundamentals.turnoverRate ?? -999) - (b.fundamentals.turnoverRate ?? -999),
          width: 62,
          render: (_, r) => {
            const v = r.fundamentals.turnoverRate;
            const col = v != null && v > 10 ? "var(--red)" : v != null && v > 5 ? "var(--gold)" : undefined;
            return <span style={{ fontFamily: "monospace", color: col, fontSize: 12, fontWeight: v != null && v > 10 ? 700 : 400 }}>{fmt(v, 1)}%</span>;
          },
        },
        {
          title: "增减持",
          key: "insider",
          width: 76,
          render: (_, r) => <InsiderBadge trades={insiderTrades.get(r.quote.code)} />,
        },
      ],
    },
  ];

  return (
    <div>
      {/* 筛选栏 + 评分切换 */}
      <Flex align="center" gap={8} style={{ marginBottom: 12 }} wrap="wrap">
        <Input
          prefix={<SearchOutlined style={{ color: "var(--text-tertiary)" }} />}
          placeholder="筛选代码或名称..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ width: 200 }}
          size="small"
          allowClear
        />
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {filtered.length} / {data.length} 只
        </span>
        {scores && (
          <Tag
            style={{ borderRadius: 9999, cursor: "pointer", marginLeft: "auto" }}
            color={showScore ? "blue" : "default"}
            onClick={onToggleScore}
          >
            <StarOutlined style={{ marginRight: 4 }} />
            {showScore ? "隐藏评分" : "综合评分"}
          </Tag>
        )}
      </Flex>

      {/* 表格 */}
      <div
        style={{
          borderRadius: 12,
          border: "1px solid var(--border-color)",
          background: "var(--card-bg)",
          overflowX: "auto",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(r) => r.quote.code}
        loading={loading && data.length === 0}
        size="small"
        pagination={false}
        style={{ fontSize: 12 }}
        components={{
          header: {
            cell: (props: any) => (
              <th
                {...props}
                style={{
                  ...props.style,
                  padding: "10px 8px",
                  background: "var(--header-bg, rgba(128,128,128,0.06))",
                  fontWeight: 600,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  borderBottom: "1px solid var(--border-color)",
                }}
              />
            ),
          },
          body: {
            cell: (props: any) => (
              <td
                {...props}
                style={{
                  ...props.style,
                  padding: "10px 8px",
                  borderBottom: "1px solid var(--border-color)",
                }}
              />
            ),
          },
        }}
        expandable={{
          expandedRowRender: (record) => (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 360px", minWidth: 320, borderRight: "1px solid var(--border-color, rgba(255,255,255,0.06))", paddingRight: 24 }}>
                <ValuationPanel code={record.quote.code} visible />
              </div>
              <div style={{ flex: "1 1 360px", minWidth: 320 }}>
                <ShareholderTrend code={record.quote.code} visible />
              </div>
            </div>
          ),
          rowExpandable: () => true,
          expandedRowKeys: expandedCode ? [expandedCode] : [],
          onExpand: (expanded, record) => setExpandedCode(expanded ? record.quote.code : null),
        }}
        rowClassName={(record) => {
          const hasAlert = triggeredCodes.has(record.quote.code);
          return hasAlert ? "ant-table-row-alert" : "";
        }}
      />
      </div>
    </div>
  );
}
