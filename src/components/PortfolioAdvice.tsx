// ============================================================
// PortfolioAdvice.tsx — 持仓操作建议面板
// ============================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Flex, Typography, Tag, Spin, Tooltip, Empty, Collapse, Divider, Space } from "antd";
import { BulbOutlined, ReloadOutlined, RiseOutlined, FallOutlined, GiftOutlined, SafetyOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioSync } from "@/hooks/usePortfolioSync";

const { Text, Title } = Typography;

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toFixed(d) : "--";

const fmtPct = (v: number | null | undefined): string =>
  v != null ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";

const fmtMoney = (v: number | null | undefined): string =>
  v != null ? "¥" + v.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) : "--";

interface PortfolioAdviceProps {
  stockDataMap: Map<string, StockData>;
}

interface AdviceItem {
  action: string;
  reason: string;
  priority: "high" | "medium" | "low" | "info";
}

interface StockAdvice {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  buyPrice: number;
  costBasis: number;
  shares: number;
  marketValue: number;
  totalProfit: number;
  totalProfitPct: number;
  totalDividends: number;
  realCost: number;
  costYield: number | null;
  dividendYield: number | null;
  pe: number | null;
  daysHeld: number;
  gridVolatility: number;
  gridStep: number;
  gridLevels: Array<{ type: "buy" | "sell"; price: number; drop_pct?: number; rise_pct?: number; label: string }>;
  operations: AdviceItem[];
  adviceSummary: {
    costAdvice: AdviceItem[];
    dividendAdvice: AdviceItem[];
    valuationAdvice: AdviceItem[];
  };
}

export default function PortfolioAdvice({ stockDataMap }: PortfolioAdviceProps) {
  const { positions } = usePortfolio(stockDataMap);
  usePortfolioSync(positions);

  const [advice, setAdvice] = useState<StockAdvice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  const fetchAdvice = useCallback(async () => {
    if (positions.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-advice");
      const json = await res.json();
      if (json.success && Array.isArray(json.advice)) {
        setAdvice(json.advice);
        setExpanded(json.advice.map((a: StockAdvice) => a.stockCode));
      } else {
        setError(json.note || "暂无数据");
      }
    } catch {
      setError("获取建议失败");
    } finally {
      setLoading(false);
    }
  }, [positions]);

  // 首次自动加载
  useEffect(() => {
    if (positions.length > 0 && advice === null && !loading) {
      const t = setTimeout(() => fetchAdvice(), 500);
      return () => clearTimeout(t);
    }
  }, [positions, advice, loading, fetchAdvice]);

  if (positions.length === 0) return null;

  const priorityColor = (p: string) => {
    switch (p) {
      case "high": return "red";
      case "medium": return "orange";
      case "low": return "default";
      default: return "blue";
    }
  };

  const priorityLabel = (p: string) => {
    switch (p) {
      case "high": return "重要";
      case "medium": return "建议";
      case "low": return "参考";
      default: return "提示";
    }
  };

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}
      title={
        <Flex align="center" gap={8}>
          <BulbOutlined />
          <span style={{ fontWeight: 600 }}>操作建议</span>
        </Flex>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined spin={loading} />}
          onClick={fetchAdvice}
          loading={loading}
          type="text"
        >
          刷新
        </Button>
      }
    >
      {loading && advice === null && (
        <Flex align="center" justify="center" style={{ padding: 32 }}>
          <Spin tip="分析持仓中..." />
        </Flex>
      )}

      {error && !advice && (
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {advice && advice.length === 0 && (
        <Empty description="暂无操作建议" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {advice && advice.length > 0 && (
        <Collapse
          ghost
          size="small"
          activeKey={expanded}
          onChange={(keys) => setExpanded(keys as string[])}
          items={advice.map((item) => ({
            key: item.stockCode,
            label: (
              <Flex align="center" justify="space-between" style={{ width: "100%", paddingRight: 8 }}>
                <Flex align="center" gap={8}>
                  <Text strong style={{ fontSize: 14 }}>{item.stockName}</Text>
                  <Text type="secondary" style={{ fontSize: 11, fontFamily: "var(--font-geist-mono)" }}>
                    {item.stockCode}
                  </Text>
                  {item.operations.filter((o) => o.priority === "high").length > 0 && (
                    <Tag color="red" style={{ fontSize: 10, lineHeight: "16px" }}>
                      {item.operations.filter((o) => o.priority === "high").length} 条重点
                    </Tag>
                  )}
                </Flex>
                <Flex align="center" gap={12}>
                  <Text style={{
                    fontSize: 13, fontFamily: "var(--font-geist-mono)",
                    color: item.totalProfit > 0 ? "#ef4444" : item.totalProfit < 0 ? "#22c55e" : "#9ca3af",
                    fontWeight: Math.abs(item.totalProfitPct) > 20 ? 700 : 400,
                  }}>
                    {fmtPct(item.totalProfitPct)}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: "var(--font-geist-mono)" }}>
                    ¥{fmt(item.currentPrice)}
                  </Text>
                </Flex>
              </Flex>
            ),
            children: (
              <div>
                {/* 速览指标 */}
                <Flex wrap="wrap" gap={8} style={{ marginBottom: 12 }}>
                  <Tag style={{ fontSize: 11 }}>成本 ¥{fmt(item.costBasis)}</Tag>
                  <Tag style={{ fontSize: 11 }}>现价 ¥{fmt(item.currentPrice)}</Tag>
                  {item.pe != null && <Tag style={{ fontSize: 11 }}>PE {fmt(item.pe)}</Tag>}
                  {item.dividendYield != null && <Tag color="green" style={{ fontSize: 11 }}>股息率 {fmt(item.dividendYield)}%</Tag>}
                  {item.costYield != null && <Tag color="green" style={{ fontSize: 11 }}>成本股息率 {fmt(item.costYield)}%</Tag>}
                  <Tag style={{ fontSize: 11 }}>{item.shares} 股</Tag>
                </Flex>

                {/* 操作建议 */}
                {item.operations.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
                      <ThunderboltOutlined style={{ marginRight: 4 }} />操作建议
                    </Text>
                    {item.operations.map((op, i) => (
                      <Flex key={i} align="flex-start" gap={8} style={{ marginBottom: 4 }}>
                        <Tag color={priorityColor(op.priority)} style={{ fontSize: 10, lineHeight: "16px", flexShrink: 0, marginTop: 2 }}>
                          {priorityLabel(op.priority)}
                        </Tag>
                        <div>
                          <Text strong style={{ fontSize: 13, marginRight: 4 }}>{op.action}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{op.reason}</Text>
                        </div>
                      </Flex>
                    ))}
                  </div>
                )}

                {/* 网格交易 */}
                <Divider style={{ margin: "8px 0" }} />
                <Text strong style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
                  📐 网格交易参考（步长 {item.gridStep}%）
                </Text>
                <Flex wrap="wrap" gap={4}>
                  {item.gridLevels.map((level, i) => (
                    <Tag
                      key={i}
                      color={level.type === "buy" ? "green" : "red"}
                      style={{ fontSize: 11, cursor: "default" }}
                    >
                      {level.type === "buy" ? <RiseOutlined /> : <FallOutlined />}
                      {" "}¥{fmt(level.price)} {level.label}
                    </Tag>
                  ))}
                </Flex>

                {/* 详细建议摘要 */}
                <Divider style={{ margin: "8px 0" }} />
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: "detail",
                      label: <Text type="secondary" style={{ fontSize: 12 }}>详细分析 ↓</Text>,
                      children: (
                        <div>
                          {item.adviceSummary.costAdvice.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>📊 成本策略</Text>
                              {item.adviceSummary.costAdvice.map((a, i) => (
                                <div key={i} style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                  • {a.action}: {a.reason}
                                </div>
                              ))}
                            </div>
                          )}
                          {item.adviceSummary.dividendAdvice.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>💰 分红策略</Text>
                              {item.adviceSummary.dividendAdvice.map((a, i) => (
                                <div key={i} style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                  • {a.action}: {a.reason}
                                </div>
                              ))}
                            </div>
                          )}
                          {item.adviceSummary.valuationAdvice.length > 0 && (
                            <div>
                              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>📈 估值提示</Text>
                              {item.adviceSummary.valuationAdvice.map((a, i) => (
                                <div key={i} style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                  • {a.action}: {a.reason}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          } as any))}
        />
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: "#9ca3af" }}>
        操作建议仅供参考，不构成投资建议。基于收盘后数据分析生成。
      </div>
    </Card>
  );
}
