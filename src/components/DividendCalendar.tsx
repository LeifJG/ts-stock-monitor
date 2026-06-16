// ============================================================
// DividendCalendar.tsx — C. 分红日历
// ============================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Flex, Typography, Tag, Tooltip, Spin, Empty, Badge } from "antd";
import { CalendarOutlined, GiftOutlined } from "@ant-design/icons";
import type { StockCode, DividendCalendarEvent } from "@/lib/types";

const { Text } = Typography;

const fmt = (v: number): string => v.toFixed(4);

interface DividendCalendarProps {
  watchlist: StockCode[];
}

export default function DividendCalendar({ watchlist }: DividendCalendarProps) {
  const [calendarData, setCalendarData] = useState<DividendCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCalendar = useCallback(async () => {
    if (watchlist.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dividend-calendar?codes=${watchlist.join(",")}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const allEvents: DividendCalendarEvent[] = [];
        for (const item of json.data) {
          if (item.events && Array.isArray(item.events)) {
            allEvents.push(...item.events);
          }
        }
        // 过滤：只保留未来6个月内的预测事件
        const sixMonthsLater = new Date();
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        const filtered = allEvents.filter((e) => {
          const d = new Date(e.date);
          return d >= new Date() && d <= sixMonthsLater;
        });
        filtered.sort((a, b) => a.date.localeCompare(b.date));
        setCalendarData(filtered);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [watchlist]);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  // 按月份分组
  const monthGroups = useMemo(() => {
    const groups = new Map<string, DividendCalendarEvent[]>();
    for (const event of calendarData) {
      const monthKey = event.date.slice(0, 7); // "YYYY-MM"
      if (!groups.has(monthKey)) groups.set(monthKey, []);
      groups.get(monthKey)!.push(event);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [calendarData]);

  // 月份中文
  const monthNames = ["", "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月"];

  if (watchlist.length === 0) return null;

  const upcomingCount = calendarData.length;

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}
      title={
        <Flex align="center" gap={8}>
          <CalendarOutlined />
          <span style={{ fontWeight: 600 }}>分红日历</span>
        </Flex>
      }
      extra={
        <Flex align="center" gap={8}>
          {loading && <Spin size="small" />}
          <Badge
            count={upcomingCount}
            size="small"
            style={{ background: "#16a34a" }}
            showZero
          />
        </Flex>
      }
    >
      {monthGroups.length === 0 && !loading ? (
        <Empty
          description="暂无近期分红预测"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            基于历史分红数据预测，连续分红2年以上才会显示
          </Text>
        </Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {monthGroups.map(([monthKey, events]) => {
            const [y, m] = monthKey.split("-");
            const monthName = monthNames[parseInt(m)] || m;
            const now = new Date();
            const isCurrentMonth =
              now.getFullYear() === parseInt(y) && now.getMonth() + 1 === parseInt(m);

            return (
              <div key={monthKey}>
                {/* 月份标题 */}
                <Flex align="center" gap={6} style={{ marginBottom: 8 }}>
                  <div style={{
                    width: 4, height: 16, borderRadius: 2,
                    background: isCurrentMonth ? "#2563eb" : "#d1d5db",
                  }} />
                  <Text strong style={{ fontSize: 14, color: isCurrentMonth ? "#2563eb" : undefined }}>
                    {y}.{m.padStart(2, "0")} {monthName}
                  </Text>
                  {isCurrentMonth && (
                    <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px" }}>本月</Tag>
                  )}
                </Flex>

                {/* 当月事件列表 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {events.map((event, i) => (
                    <Flex
                      key={`${event.stockCode}-${event.date}-${i}`}
                      align="center"
                      gap={8}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "#f9fafb",
                        border: "1px solid #f3f4f6",
                      }}
                    >
                      <GiftOutlined style={{ color: "#16a34a", fontSize: 14 }} />
                      <div style={{ flex: 1 }}>
                        <Text strong style={{ fontSize: 13 }}>{event.stockName}</Text>
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                          {event.stockCode}
                        </Text>
                      </div>
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: "var(--font-geist-mono)",
                          fontWeight: 600,
                          color: "#16a34a",
                        }}
                      >
                        ¥{fmt(event.perShare)}
                      </Text>
                      <Tooltip
                        title={
                          <div>
                            <div>预计除权除息日: {event.date}</div>
                            <div>类型: {event.type === "annual" ? "年度分红" : event.type === "interim" ? "中期分红" : "特别分红"}</div>
                            <div>可信度: {event.confidence === "high" ? "高 (连续3年+同月)" : event.confidence === "medium" ? "中 (连续2年)" : "低 (波动较大)"}</div>
                          </div>
                        }
                        color="#1f2937"
                      >
                        <Tag
                          color={event.confidence === "high" ? "green" : event.confidence === "medium" ? "blue" : "default"}
                          style={{ fontSize: 10, lineHeight: "16px", cursor: "pointer" }}
                        >
                          {event.confidence === "high" ? "高置信" : event.confidence === "medium" ? "中置信" : "低置信"}
                        </Tag>
                      </Tooltip>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {event.date.slice(8, 10)}日
                      </Text>
                    </Flex>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
