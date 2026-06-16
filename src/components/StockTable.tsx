// ============================================================
// StockTable.tsx — 股票数据表格视图
// ============================================================
// 支持排序、颜色高亮异常数值。

"use client";

import { useState, useMemo } from "react";
import type { StockData, AlertTrigger, SortField, SortOrder } from "@/lib/types";
import { SORT_LABELS } from "@/lib/constants";
import { fearGaugeColor, safetyScoreColor } from "@/lib/indicators";

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

function Th({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <th
      className="cursor-pointer px-2 py-2 text-xs font-medium text-gray-500 transition hover:text-blue-600 select-none"
      onClick={onClick}
    >
      {children}
    </th>
  );
}
