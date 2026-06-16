// ============================================================
// StockList.tsx — 股票卡片列表容器
// ============================================================

"use client";

import { Flex, Empty, Spin, Alert } from "antd";
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
      <Flex justify="center" style={{ padding: 60 }}>
        <Spin tip="加载中..." />
      </Flex>
    );
  }

  if (error) {
    return <Alert message={error} type="error" showIcon style={{ borderRadius: 12 }} />;
  }

  if (data.length === 0) {
    return <Empty description="暂无股票数据，请检查自选股配置" style={{ padding: 40 }} />;
  }

  // 按是否有告警排序（有告警的排前面）
  const sorted = [...data].sort((a, b) => {
    const aAlerts = triggers.filter((t) => t.stockCode === a.quote.code).length;
    const bAlerts = triggers.filter((t) => t.stockCode === b.quote.code).length;
    return bAlerts - aAlerts;
  });

  return (
    <Flex wrap="wrap" gap={16}>
      {sorted.map((item) => (
        <div key={item.quote.code} style={{ width: "calc(33.333% - 12px)", minWidth: 320 }}>
          <StockCard
            data={item}
            alerts={triggers.filter((t) => t.stockCode === item.quote.code)}
          />
        </div>
      ))}
    </Flex>
  );
}
