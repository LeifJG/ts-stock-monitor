// ============================================================
// StockCard.tsx — 单只股票的行情卡片
// ============================================================
// 展示股票名称、价格、涨跌幅、基本面指标，以及安全边际评分和恐慌指数。

"use client";

import type { StockData, AlertTrigger } from "@/lib/types";
import { fearGaugeColor, fearGaugeBg, safetyScoreColor } from "@/lib/indicators";

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

/** 恐慌指数进度条 */
function FearBar({ value }: { value: number }) {
  const color = fearGaugeColor(value);
  const bgColor = value < 40 ? "bg-green-200" : value < 60 ? "bg-yellow-200" : "bg-red-200";
  const fillColor = value < 40 ? "bg-green-500" : value < 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400">恐慌</span>
      <div className={`h-1.5 flex-1 rounded-full ${bgColor}`}>
        <div
          className={`h-1.5 rounded-full ${fillColor}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-[10px] font-medium ${color}`}>{value}</span>
    </div>
  );
}

export default function StockCard({ data, alerts }: StockCardProps) {
  const { quote, fundamentals, safetyScore, fearGauge } = data;
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

      {/* 头部：代码 + 名称 + 安全边际 */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-lg font-bold text-gray-900">{quote.name}</span>
          <span className="ml-2 text-sm text-gray-400">{quote.code}</span>
        </div>
        {/* 安全边际徽章 */}
        {safetyScore?.grade && safetyScore.score != null && (
          <div className={`rounded-full px-2 py-0.5 text-xs font-bold ${safetyScoreColor(safetyScore.score)}`}>
            {safetyScore.grade} · {safetyScore.score}
          </div>
        )}
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
        <MetricItem label="换手率" value={fundamentals.turnoverRate != null ? fundamentals.turnoverRate.toFixed(2) + "%" : "--"} />
        <MetricItem label="每股收益" value={fundamentals.eps != null ? formatLarge(fundamentals.eps, 3) : "--"} />
      </div>

      {/* 恐慌指数 */}
      {fearGauge && (
        <div className={`mt-3 rounded-md p-2 ${fearGaugeBg(fearGauge.overall)}`}>
          <div className="flex items-center justify-between text-xs">
            <span className={`font-medium ${fearGaugeColor(fearGauge.overall)}`}>
              {fearGauge.label}
            </span>
            <span className="text-gray-400">
              涨跌 {fearGauge.drawdown} · 波动 {fearGauge.rsi} · 换手 {fearGauge.macd}
            </span>
          </div>
          <FearBar value={fearGauge.overall} />
        </div>
      )}

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
