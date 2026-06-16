// ============================================================
// StockTable.tsx — 股票数据表格视图
// ============================================================
// 支持排序、颜色高亮异常数值。

"use client";

import { useState, useMemo } from "react";
import type { StockData, AlertTrigger, SortField, SortOrder } from "@/lib/types";
import { SORT_LABELS } from "@/lib/constants";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";
import { Tooltip } from "antd";

// ─── 列头帮助气泡内容 ─────────────────────────────────────────

const COL_HELP: Record<string, { formula: string; meaning: string }> = {
  pe: {
    formula: "股价 ÷ 每股收益",
    meaning: "按当前利润，买一股多少年回本。越低越便宜，<10 低估，>50 高估。亏损股为负数。",
  },
  pb: {
    formula: "股价 ÷ 每股净资产",
    meaning: "股价是净资产的多少倍。<1 为破净（折价），>5 说明市场愿意为品牌/技术付溢价。",
  },
  marketCap: {
    formula: "股价 × 总股本",
    meaning: "公司全部股票的总价值。大市值 = 大盘股，波动相对小。单位：亿元。",
  },
  dividendYield: {
    formula: "每股分红 ÷ 股价 × 100%",
    meaning: "买入后每年能拿回多少现金股息。>5% 算高股息，>8% 需警惕是否可持续。",
  },
  turnoverRate: {
    formula: "成交量 ÷ 流通股本 × 100%",
    meaning: "一天内多少人买卖。>5% 活跃，>10% 过热（可能是出货）。<0.5% 冷门。",
  },
  roe: {
    formula: "PB ÷ PE × 100%（或 净利润÷净资产）",
    meaning: "每 1 元净资产每年能赚多少利润。>20% 优秀，>15% 良好，<5% 低于理财。",
  },
  dividendPayoutRatio: {
    formula: "每股分红 ÷ 每股收益 × 100%",
    meaning: "利润里拿出多少来分红。<30% 偏保守，30-60% 健康，>100% 不可持续（吃老本）。",
  },
  debtRatio: {
    formula: "总负债 ÷ 总资产 × 100%",
    meaning: "公司资产有多少是借来的。<50% 稳健，50-70% 正常，>70% 高杠杆需警惕。银行股除外。",
  },
  fearIndex: {
    formula: "涨跌幅×35% + 振幅×35% + 换手率×30%",
    meaning: "综合恐慌指数 0-100。>60 恐慌（或抄底机会），<40 贪婪（或追高风险）。",
  },
  safetyScore: {
    formula: "(格雷厄姆估值 - 现价) ÷ 估值 × 100%",
    meaning: "安全边际 0-100。>60 被低估，40-60 合理偏低，<20 高估/危险。基于格雷厄姆公式。",
  },
};

interface StockTableProps {
  data: StockData[];
  triggers: AlertTrigger[];
  loading: boolean;
  error: string | null;
}

// ─── 异常值判断 ─────────────────────────────────────────────────

function isAbnormal(val: number | null | undefined, field: string): { abnormal: boolean; className: string } {
  if (val == null) return { abnormal: false, className: "" };

  switch (field) {
    case "changePercent":
      if (val > 9.5) return { abnormal: true, className: "text-red-600 font-bold" };
      if (val < -9.5) return { abnormal: true, className: "text-green-600 font-bold" };
      if (val > 5) return { abnormal: true, className: "text-red-500" };
      if (val < -5) return { abnormal: true, className: "text-green-500" };
      return { abnormal: false, className: val > 0 ? "text-red-500" : val < 0 ? "text-green-500" : "" };
    case "turnoverRate":
      if (val > 10) return { abnormal: true, className: "text-orange-600 font-bold" };
      if (val > 5) return { abnormal: true, className: "text-orange-500" };
      return { abnormal: false, className: "" };
    case "pe":
      if (val < 0) return { abnormal: true, className: "text-gray-400" };
      if (val > 100) return { abnormal: true, className: "text-orange-500" };
      return { abnormal: false, className: "" };
    case "volume":
      // 成交量异常（判断基于未标准化数据，简化版）
      if (val > 100000000) return { abnormal: true, className: "text-orange-600 font-bold" };
      return { abnormal: false, className: "" };
    case "dividendYield":
      if (val > 5) return { abnormal: true, className: "text-green-600 font-bold" };
      return { abnormal: false, className: "" };
    default:
      return { abnormal: false, className: "" };
  }
}

// ─── 格式化 ─────────────────────────────────────────────────────

function fmt(val: number | null | undefined, digits = 2, suffix = ""): string {
  if (val == null) return "--";
  return val.toFixed(digits) + suffix;
}

function fmtLarge(val: number | null | undefined, digits = 2): string {
  if (val == null) return "--";
  return val.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ─── 排序键提取 ────────────────────────────────────────────────

function sortKey(data: StockData, field: SortField): number {
  switch (field) {
    case "code": return parseFloat(data.quote.code);
    case "name": return 0; // 字符串排序不用此路径
    case "currentPrice": return data.quote.currentPrice;
    case "changePercent": return data.quote.changePercent;
    case "pe": return data.fundamentals.pe ?? 0;
    case "pb": return data.fundamentals.pb ?? 0;
    case "marketCap": return data.fundamentals.marketCap ?? 0;
    case "dividendYield": return data.fundamentals.dividendYield ?? -999;
    case "turnoverRate": return data.fundamentals.turnoverRate ?? -999;
    case "fearIndex": return data.fearGauge?.overall ?? -1;
    case "safetyScore": return data.safetyScore?.score ?? -1;
    case "roe": return data.fundamentals.roe ?? -999;
    case "dividendPayoutRatio": return data.fundamentals.dividendPayoutRatio ?? -999;
    case "debtRatio": return data.fundamentals.debtRatio ?? -999;
  }
}

// ─── 组件 ───────────────────────────────────────────────────────

export default function StockTable({ data, triggers, loading, error }: StockTableProps) {
  const [sortField, setSortField] = useState<SortField>("changePercent");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filterText, setFilterText] = useState("");

  // 触发告警的股票代码集合
  const triggeredCodes = useMemo(() => new Set(triggers.map((t) => t.stockCode)), [triggers]);

  // 排序
  const sorted = useMemo(() => {
    let list = [...data];
    if (filterText.trim()) {
      const keyword = filterText.trim().toLowerCase();
      list = list.filter(
        (s) => s.quote.code.includes(keyword) || s.quote.name.toLowerCase().includes(keyword)
      );
    }
    list.sort((a, b) => {
      const aVal = sortKey(a, sortField);
      const bVal = sortKey(b, sortField);
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [data, sortField, sortOrder, filterText]);

  // 切换排序
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // 排序列头箭头
  function SortArrow(field: SortField) {
    if (sortField !== field) return <span className="ml-0.5 text-gray-300">↕</span>;
    return <span className="ml-0.5 text-blue-500">{sortOrder === "asc" ? "↑" : "↓"}</span>;
  }

  // ── 渲染 ──

  if (loading && data.length === 0) {
    return <div className="rounded-xl bg-gray-50 p-10 text-center text-sm text-gray-400">加载中...</div>;
  }
  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">{error}</div>;
  }
  if (sorted.length === 0) {
    return <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
      {filterText ? "未找到匹配的股票" : "暂无股票数据"}
    </div>;
  }

  return (
    <div>
      {/* 筛选栏 */}
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          placeholder="筛选代码或名称..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-48 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        />
        <span className="text-xs text-gray-400">
          {sorted.length} / {data.length} 只
        </span>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <Th onClick={() => toggleSort("code")}>代码{SortArrow("code")}</Th>
              <Th onClick={() => toggleSort("name")}>名称{SortArrow("name")}</Th>
              <Th onClick={() => toggleSort("currentPrice")}>现价{SortArrow("currentPrice")}</Th>
              <Th onClick={() => toggleSort("changePercent")}>涨跌幅{SortArrow("changePercent")}</Th>
              <Th onClick={() => toggleSort("pe")}>市盈率{SortArrow("pe")}</Th>
              <Th onClick={() => toggleSort("pb")}>市净率{SortArrow("pb")}</Th>
              <Th onClick={() => toggleSort("marketCap")}>总市值{SortArrow("marketCap")}</Th>
              <Th onClick={() => toggleSort("dividendYield")}>股息率{SortArrow("dividendYield")}</Th>
              <Th onClick={() => toggleSort("turnoverRate")}>换手率{SortArrow("turnoverRate")}</Th>
              <Th onClick={() => toggleSort("roe")}>ROE{SortArrow("roe")}</Th>
              <Th onClick={() => toggleSort("dividendPayoutRatio")}>支付率{SortArrow("dividendPayoutRatio")}</Th>
              <Th onClick={() => toggleSort("debtRatio")}>负债率{SortArrow("debtRatio")}</Th>
              <Th onClick={() => toggleSort("fearIndex")}>恐慌{SortArrow("fearIndex")}</Th>
              <Th onClick={() => toggleSort("safetyScore")}>安全{SortArrow("safetyScore")}</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const { quote, fundamentals, safetyScore, fearGauge } = s;
              const hasAlert = triggeredCodes.has(quote.code);

              return (
                <tr
                  key={quote.code}
                  className={`border-b border-gray-100 transition hover:bg-gray-50 ${
                    hasAlert ? "bg-amber-50/60" : ""
                  } ${sorted.indexOf(s) % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                >
                  <td className="px-2 py-2 font-mono text-gray-500">{quote.code}</td>
                  <td className={`px-2 py-2 font-medium ${hasAlert ? "text-amber-700" : "text-gray-900"}`}>
                    {hasAlert && <span className="mr-1">🔔</span>}
                    {quote.name}
                  </td>
                  <td className="px-2 py-2 font-mono">{fmt(quote.currentPrice, 2)}</td>
                  <td className={`px-2 py-2 font-mono ${isAbnormal(quote.changePercent, "changePercent").className}`}>
                    {quote.changePercent > 0 ? "+" : ""}{fmt(quote.changePercent, 2)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${isAbnormal(fundamentals.pe, "pe").className}`}>
                    {fmt(fundamentals.pe, 2)}
                  </td>
                  <td className="px-2 py-2 font-mono">{fmt(fundamentals.pb, 2)}</td>
                  <td className="px-2 py-2 font-mono">{fmtLarge(fundamentals.marketCap, 1)}</td>
                  <td className={`px-2 py-2 font-mono ${isAbnormal(fundamentals.dividendYield, "dividendYield").className}`}>
                    {fmt(fundamentals.dividendYield, 2)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${isAbnormal(fundamentals.turnoverRate, "turnoverRate").className}`}>
                    {fmt(fundamentals.turnoverRate, 2)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${fundamentals.roe != null && fundamentals.roe > 20 ? "text-green-600 font-bold" : ""}`}>
                    {fmt(fundamentals.roe, 1)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${fundamentals.dividendPayoutRatio != null && fundamentals.dividendPayoutRatio > 100 ? "text-red-500 font-bold" : fundamentals.dividendPayoutRatio != null && fundamentals.dividendPayoutRatio < 30 ? "text-yellow-500" : ""}`}>
                    {fmt(fundamentals.dividendPayoutRatio, 1)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${fundamentals.debtRatio != null && fundamentals.debtRatio > 70 ? "text-red-500 font-bold" : fundamentals.debtRatio != null && fundamentals.debtRatio > 50 ? "text-orange-500" : ""}`}>
                    {fmt(fundamentals.debtRatio, 1)}%
                  </td>
                  <td className={`px-2 py-2 font-mono ${fearGaugeColor(fearGauge?.overall ?? -1)}`}>
                    {fearGauge?.overall ?? "--"}
                  </td>
                  <td className={`px-2 py-2 font-mono ${safetyScoreColor(safetyScore?.score ?? null)}`}>
                    {safetyScore?.score != null ? safetyScore.score : "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, onClick, help }: { children: React.ReactNode; onClick: () => void; help?: { formula: string; meaning: string } }) {
  const content = (
    <span className="border-b border-dotted border-gray-300 hover:border-blue-400">
      {children}
    </span>
  );

  if (help) {
    return (
      <th
        className="cursor-pointer px-2 py-2 text-xs font-medium text-gray-500 transition hover:text-blue-600 select-none"
        onClick={onClick}
      >
        <Tooltip
          title={
            <div className="text-xs">
              <div className="mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">公式</span>
                <div className="mt-0.5 rounded bg-blue-900/40 px-1.5 py-1 font-mono text-[11px] text-blue-200">
                  {help.formula}
                </div>
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">含义</span>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-300">
                  {help.meaning}
                </p>
              </div>
            </div>
          }
          placement="top"
          color="#1f2937"
          overlayInnerStyle={{ minWidth: 220, padding: "10px 12px" }}
        >
          {content}
        </Tooltip>
      </th>
    );
  }

  return (
    <th
      className="cursor-pointer px-2 py-2 text-xs font-medium text-gray-500 transition hover:text-blue-600 select-none"
      onClick={onClick}
    >
      {children}
    </th>
  );
}
