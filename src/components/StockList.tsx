// ============================================================
// StockList.tsx — 股票列表容器
// ============================================================
// 负责渲染股票卡片列表，支持加载态、空态、错误态展示，并按告警数量排序。

"use client";

import type { StockData, AlertTrigger } from "@/lib/types";
import StockCard from "./StockCard";

interface StockListProps {
  data: StockData[];
  triggers: AlertTrigger[];
  loading: boolean;
  error: string | null;
}

export default function StockList({ data, triggers, loading, error }: StockListProps) {
  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
          <p className="mt-3 text-sm text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
        暂无股票数据，请检查自选股配置
      </div>
    );
  }

  // 按是否有告警排序（有告警的排前面）
  const sorted = [...data].sort((a, b) => {
    const aAlerts = triggers.filter((t) => t.stockCode === a.quote.code).length;
    const bAlerts = triggers.filter((t) => t.stockCode === b.quote.code).length;
    return bAlerts - aAlerts;
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {sorted.map((item) => (
        <StockCard
          key={item.quote.code}
          data={item}
          alerts={triggers.filter((t) => t.stockCode === item.quote.code)}
        />
      ))}
    </div>
  );
}
