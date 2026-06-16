// ============================================================
// IndexCards.tsx — 大盘指数卡片（上证指数 + 创业板指）
// ============================================================
// 展示指数行情 + 恐慌指数进度条。

"use client";

import type { IndexData } from "@/lib/types";
import { fearGaugeColor, fearGaugeBg } from "@/lib/indicators";

interface IndexCardsProps {
  indices: IndexData[];
  loading: boolean;
}

function FearBar({ value }: { value: number }) {
  const fillColor = value < 40 ? "bg-green-500" : value < 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 flex-1 rounded-full bg-gray-200">
        <div className={`h-1 rounded-full ${fillColor}`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${fearGaugeColor(value)}`}>{value}</span>
    </div>
  );
}

export default function IndexCards({ indices, loading }: IndexCardsProps) {
  if (loading) {
    return (
      <div className="mb-4 flex gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 w-48 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }
  if (indices.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {indices.map((idx) => {
        const { quote, fearGauge } = idx;
        const isUp = quote.changePercent > 0;
        const changeColor = isUp ? "text-red-500" : "text-green-500";
        const bgColor = isUp ? "bg-red-50" : "bg-green-50";
        const borderColor = isUp ? "border-red-200" : "border-green-200";

        return (
          <div key={quote.code} className={`flex w-48 flex-col rounded-xl border ${borderColor} ${bgColor} p-3`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-700">{quote.name}</span>
              <span className={`text-xs font-medium ${changeColor}`}>
                {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
              </span>
            </div>
            <div className="mt-1">
              <span className={`text-xl font-bold ${changeColor}`}>{quote.currentPrice.toFixed(2)}</span>
              <span className={`ml-1 text-xs ${changeColor}`}>
                {isUp ? "+" : ""}{quote.changeAmount.toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5">
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className={`font-medium ${fearGaugeColor(fearGauge.overall)}`}>{fearGauge.label}</span>
                <span className="text-gray-400">恐慌指数</span>
              </div>
              <FearBar value={fearGauge.overall} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
