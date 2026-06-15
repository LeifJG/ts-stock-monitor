// ============================================================
// StockCard.tsx — 单只股票的行情卡片
// ============================================================

"use client";

import type { StockData, AlertTrigger } from "@/lib/types";
import { FIELD_UNITS } from "@/lib/constants";

interface StockCardProps {
  data: StockData;
  alerts: AlertTrigger[];
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

function formatVolume(v: number): string {
  if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return v.toFixed(0);
}

/** 根据涨跌幅返回颜色类名 */
function changeColorClass(pct: number): string {
  if (pct > 0) return "text-red-500";
  if (pct < 0) return "text-green-500";
  return "text-gray-400";
}

function changeBgClass(pct: number): string {
  if (pct > 0) return "bg-red-50 border-red-200";
  if (pct < 0) return "bg-green-50 border-green-200";
  return "bg-gray-50 border-gray-200";
}

export default function StockCard({ data, alerts }: StockCardProps) {
  const { quote, fundamentals } = data;
  const isUp = quote.changePercent > 0;
  const isDown = quote.changePercent < 0;
  const hasAlerts = alerts.length > 0;

  return (
    <div
      className={`relative rounded-xl border-2 p-4 transition-shadow hover:shadow-md ${
        hasAlerts
          ? "border-amber-400 bg-amber-50/50 shadow-amber-100"
          : isUp
          ? "border-red-200 bg-white"
          : isDown
          ? "border-green-200 bg-white"
          : "border-gray-200 bg-white"
      }`}
    >
      {/* 告警标记 */}
      {hasAlerts && (
        <div className="absolute -top-2.5 -right-2.5 z-10 flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-white shadow">
          <span>🔔</span>
          <span>{alerts.length}</span>
        </div>
      )}

      {/* 头部：代码 + 名称 */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-lg font-bold text-gray-900">{quote.name}</span>
          <span className="ml-2 text-sm text-gray-400">{quote.code}</span>
        </div>
      </div>

      {/* 价格区域 */}
      <div className="mb-3 flex items-baseline gap-3">
        <span className={`text-3xl font-bold ${changeColorClass(quote.changePercent)}`}>
          {formatPrice(quote.currentPrice)}
        </span>
        <span className={`text-sm font-medium ${changeColorClass(quote.changePercent)}`}>
          {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
        </span>
        <span className={`text-xs ${changeColorClass(quote.changePercent)}`}>
          {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
        </span>
      </div>

      {/* 基本面指标网格 */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <MetricItem label="市盈率" value={fundamentals.pe != null ? formatLarge(fundamentals.pe, 2) : "--"} />
        <MetricItem label="市净率" value={fundamentals.pb != null ? formatLarge(fundamentals.pb, 2) : "--"} />
        <MetricItem label="总市值" value={fundamentals.marketCap != null ? formatLarge(fundamentals.marketCap, 0) + "亿" : "--"} />
        <MetricItem
          label="股息率"
          value={fundamentals.dividendYield != null ? fundamentals.dividendYield.toFixed(2) + "%" : "--"}
          highlight={alerts.some((a) => a.field === "dividendYield")}
        />
        <MetricItem
          label="最高"
          value={formatPrice(quote.high)}
          highlight={alerts.some((a) => a.field === "currentPrice" && a.currentValue === quote.high)}
        />
        <MetricItem
          label="最低"
          value={formatPrice(quote.low)}
          highlight={alerts.some((a) => a.field === "currentPrice" && a.currentValue === quote.low)}
        />
      </div>

      {/* 成交信息 */}
      <div className="mt-3 text-xs text-gray-400">
        成交量 {formatVolume(quote.volume)}手
        <span className="mx-1">·</span>
        成交额 {formatLarge(quote.amount / 1e8, 2)}亿
      </div>
    </div>
  );
}

function MetricItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-md p-1.5 ${highlight ? "bg-amber-100 ring-1 ring-amber-300" : "bg-gray-50"}`}>
      <div className="text-gray-400">{label}</div>
      <div className={`font-medium ${highlight ? "text-amber-700" : "text-gray-700"}`}>{value}</div>
    </div>
  );
}
