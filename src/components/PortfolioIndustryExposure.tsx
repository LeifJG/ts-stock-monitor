// ============================================================
// PortfolioIndustryExposure.tsx — 持仓行业暴露与集中度
// ------------------------------------------------------------
// 和「行业分散度」（IndustryDiversity，按自选池只数）的区别：
//   这张卡只看**实际持仓**，并且按**市值**加权——因为 10 只各 3% 的票
//   和 1 只占 30% 的票，只数口径会算成一样分散，但风险完全不同。
// 口径：申万一级（电子/银行/食品饮料…），下钻到细分（半导体/白色家电…）。
// ============================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Flex, Typography, Spin, Empty, Tag, Tooltip, Divider, Button } from "antd";
import { PieChartOutlined, WarningOutlined } from "@ant-design/icons";
import { usePortfolio } from "@/hooks/usePortfolio";
import { aggregateByValue, concentrationMetrics, concentrationVerdict, type IndustryHolding } from "@/lib/industry-concentration";
import type { StockData } from "@/lib/types";

const { Text } = Typography;

const COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#be185d", "#ca8a04", "#059669", "#4f46e5",
  "#0d9488", "#b91c1c", "#1d4ed8", "#15803d", "#a16207",
  "#9333ea", "#0369a1", "#db2777", "#65a30d", "#0e7490",
];

const LEVEL_COLOR: Record<string, string> = {
  diversified: "green",
  moderate: "blue",
  concentrated: "gold",
  dangerous: "red",
};

interface Props {
  stockDataMap: Map<string, StockData>;
}

export default function PortfolioIndustryExposure({ stockDataMap }: Props) {
  const { positions, metrics } = usePortfolio(stockDataMap);
  const [industryMap, setIndustryMap] = useState<Map<string, { l1: string; l2: string; name: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const codes = useMemo(() => positions.map((p) => p.stockCode), [positions]);

  const load = useCallback(async () => {
    if (codes.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/industry?codes=${codes.join(",")}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const m = new Map<string, { l1: string; l2: string; name: string }>();
        for (const it of json.data) {
          m.set(it.code, { l1: it.l1 || "未分类", l2: it.industry || "未分类", name: it.name || it.code });
        }
        setIndustryMap(m);
        setError(null);
      } else {
        setError(json.error ?? "行业数据获取失败");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [codes]);

  useEffect(() => { load(); }, [load]);

  const holdings: IndustryHolding[] = useMemo(
    () =>
      positions.map((p) => {
        const m = metrics.get(p.id);
        const ind = industryMap.get(p.stockCode);
        return {
          code: p.stockCode,
          name: p.stockName || ind?.name || p.stockCode,
          l1: ind?.l1 ?? "未分类",
          l2: ind?.l2 ?? "未分类",
          value: m?.marketValue ?? 0,
        };
      }),
    [positions, metrics, industryMap]
  );

  const slices = useMemo(() => aggregateByValue(holdings), [holdings]);
  const stats = useMemo(() => concentrationMetrics(slices), [slices]);
  const verdict = useMemo(() => concentrationVerdict(stats), [stats]);

  if (positions.length === 0) return null;

  const totalValue = slices.reduce((s, x) => s + x.value, 0);
  // 数据没到位时绝不能给集中度结论：全部落到「未分类」会算出 HHI 10000 的假警报
  // 分母要用「去重后的代码数」——同一只票分多笔持有（大小仓）会让 8/9 这种假缺失出现
  const uniqueCodeCount = new Set(positions.map((p) => p.stockCode)).size;
  const dataReady = uniqueCodeCount > 0 && industryMap.size / uniqueCodeCount >= 0.999;

  return (
    <Card
      size="small"
      title={<span><PieChartOutlined /> 持仓行业暴露（申万一级 · 市值口径）</span>}
      extra={
        <Flex align="center" gap={6}>
          {loading && <Spin size="small" />}
          <Tag color={dataReady ? LEVEL_COLOR[verdict.level] : "default"}>{dataReady ? verdict.label : "数据缺失"}</Tag>
        </Flex>
      }
    >
      {!dataReady && !loading && (
        <div style={{ marginBottom: 8 }}>
          <Text type="warning" style={{ fontSize: 12 }}>
            行业分类数据没取到（{industryMap.size}/{uniqueCodeCount} 只有分类）
            {error ? `：${error}` : ""}——此时不做集中度判断，避免把「未分类」当成一个真行业算成 HHI 10000 的假警报。
          </Text>
          <div style={{ marginTop: 6 }}>
            <Button size="small" onClick={load}>重新获取</Button>
          </div>
        </div>
      )}

      {!dataReady ? null : slices.length === 0 && !loading ? (
        <Empty description="暂无持仓行业数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          {/* 结论 */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{verdict.headline}</div>
          {verdict.alerts.length > 0 ? (
            <div style={{ marginBottom: 10 }}>
              {verdict.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 12, color: verdict.level === "dangerous" ? "#cf1322" : "#d48806" }}>
                  <WarningOutlined /> {a}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#389e0d", marginBottom: 10 }}>
              没有触碰集中度警戒线（单一行业 &lt;30%、HHI &lt;1500）
            </div>
          )}

          {/* 堆叠条 */}
          <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
            {slices.map((s, i) => (
              <Tooltip
                key={s.industry}
                title={
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.industry} · {s.pct}%</div>
                    <div style={{ fontSize: 11 }}>{s.count} 只，市值 ¥{(s.value / 10000).toFixed(2)}万</div>
                    <div style={{ fontSize: 10, color: "#d1d5db", marginTop: 2 }}>
                      {s.details.map((d) => `${d.name}(${d.l2} ${d.pct}%)`).join("、")}
                    </div>
                  </div>
                }
              >
                <div
                  style={{
                    flex: Math.max(s.pct, 0.5),
                    background: COLORS[i % COLORS.length],
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.pct >= 12 ? `${s.industry} ${s.pct.toFixed(0)}%` : ""}
                </div>
              </Tooltip>
            ))}
          </div>

          {/* 明细 */}
          {slices.map((s, i) => (
            <Flex key={s.industry} align="center" gap={8} style={{ marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <Text style={{ fontSize: 13, minWidth: 78 }}>{s.industry}</Text>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#f3f4f6", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, s.pct)}%`, height: "100%", background: COLORS[i % COLORS.length] }} />
              </div>
              <Text type="secondary" style={{ fontSize: 12, minWidth: 52, textAlign: "right" }}>
                ¥{(s.value / 10000).toFixed(1)}万
              </Text>
              <Text strong style={{ fontSize: 12, minWidth: 44, textAlign: "right" }}>{s.pct}%</Text>
              <Text type="secondary" style={{ fontSize: 11, minWidth: 44, textAlign: "right" }}>{s.count}只</Text>
              <Text type="secondary" style={{ fontSize: 11, minWidth: 160, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.details.map((d) => d.name).join("、")}
              </Text>
            </Flex>
          ))}

          <Divider style={{ margin: "8px 0" }} />
          <div style={{ fontSize: 11, color: "#888" }}>
            总市值 ¥{(totalValue / 10000).toFixed(2)}万 · HHI {stats.hhi}
            （&lt;1500 分散 / 1500–2500 中度 / &gt;2500 高度集中）· 分类口径：申万一级（细分来自东财，缺失用内置表兜底）
          </div>
        </>
      )}
    </Card>
  );
}
