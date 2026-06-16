// ============================================================
// IndustryDiversity.tsx — D. 行业分散度
// ============================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Flex, Typography, Spin, Empty, Tooltip } from "antd";
import { PieChartOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { StockCode, IndustryData } from "@/lib/types";

const { Text } = Typography;

// ─── 柔和配色方案 ──────────────────────────────────────
const COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#be185d", "#ca8a04", "#059669", "#4f46e5",
  "#0d9488", "#b91c1c", "#1d4ed8", "#15803d", "#a16207",
  "#9333ea", "#0369a1", "#db2777", "#65a30d", "#0e7490",
];

interface IndustryDiversityProps {
  watchlist: StockCode[];
}

export default function IndustryDiversity({ watchlist }: IndustryDiversityProps) {
  const [industryData, setIndustryData] = useState<Map<string, IndustryData>>(new Map());
  const [loading, setLoading] = useState(false);

  const fetchIndustry = useCallback(async () => {
    if (watchlist.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/industry?codes=${watchlist.join(",")}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map = new Map<string, IndustryData>();
        for (const item of json.data) {
          map.set(item.code, item);
        }
        setIndustryData(map);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [watchlist]);

  useEffect(() => { fetchIndustry(); }, [fetchIndustry]);

  // 聚合行业分布
  const industryChart = useMemo(() => {
    const counts = new Map<string, { count: number; codes: string[] }>();
    for (const code of watchlist) {
      const data = industryData.get(code);
      const industry = data?.industry || "未知行业";
      if (!counts.has(industry)) counts.set(industry, { count: 0, codes: [] });
      const entry = counts.get(industry)!;
      entry.count++;
      entry.codes.push(code);
    }

    const total = watchlist.length;
    return Array.from(counts.entries())
      .map(([industry, { count, codes }], i) => ({
        industry,
        count,
        pct: (count / total) * 100,
        codes,
        color: COLORS[i % COLORS.length],
      }))
      .sort((a, b) => b.count - a.count);
  }, [industryData, watchlist]);

  if (watchlist.length === 0) return null;

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}
      title={
        <Flex align="center" gap={8}>
          <PieChartOutlined />
          <span style={{ fontWeight: 600 }}>行业分散度</span>
        </Flex>
      }
      extra={
        <Flex align="center" gap={4}>
          {loading && <Spin size="small" />}
          <Tooltip title="基于内建行业分类，覆盖A股主要股票">
            <InfoCircleOutlined style={{ fontSize: 12, color: "#9ca3af", cursor: "help" }} />
          </Tooltip>
        </Flex>
      }
    >
      {industryChart.length === 0 && !loading ? (
        <Empty description="暂无行业数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 水平堆叠条 */}
          <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden" }}>
            {industryChart.map((item) => (
              <Tooltip
                key={item.industry}
                title={
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.industry}</div>
                    <div style={{ fontSize: 11, color: "#d1d5db" }}>
                      {item.count} 只 · {item.pct.toFixed(0)}%
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                      {item.codes.join("、")}
                    </div>
                  </div>
                }
                color="#1f2937"
              >
                <div
                  style={{
                    flex: item.count,
                    background: item.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    minWidth: item.pct > 15 ? 40 : 0,
                    cursor: "pointer",
                    transition: "opacity 0.2s",
                  }}
                >
                  {item.pct > 15 ? item.industry : ""}
                </div>
              </Tooltip>
            ))}
          </div>

          {/* 详细列表 */}
          {industryChart.map((item) => (
            <Flex key={item.industry} align="center" gap={8}>
              <div
                style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: item.color, flexShrink: 0,
                }}
              />
              <Text style={{ fontSize: 13, flex: "none", minWidth: 70 }}>{item.industry}</Text>
              <div
                style={{
                  flex: 1, height: 8, borderRadius: 4,
                  background: "#f3f4f6",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${item.pct}%`,
                    height: "100%",
                    borderRadius: 4,
                    background: item.color,
                    transition: "width 0.5s",
                  }}
                />
              </div>
              <Text type="secondary" style={{ fontSize: 12, fontFamily: "var(--font-geist-mono)", minWidth: 40, textAlign: "right" }}>
                {item.count}只
              </Text>
              <Text type="secondary" style={{ fontSize: 11, fontFamily: "var(--font-geist-mono)", minWidth: 36, textAlign: "right" }}>
                {item.pct.toFixed(0)}%
              </Text>
            </Flex>
          ))}
        </div>
      )}
    </Card>
  );
}
