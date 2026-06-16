// ============================================================
// src/app/page.tsx — 主页面（Vercel 风格）
// ============================================================

"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { Button, Input, Tag, Flex, Typography, Badge, Space } from "antd";
import { TableOutlined, AppstoreOutlined, BellOutlined, CalculatorOutlined, PlusOutlined, WalletOutlined } from "@ant-design/icons";
import { useStockData } from "@/hooks/useStockData";
import { useAlerts } from "@/hooks/useAlerts";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useInsiderData } from "@/hooks/useInsiderData";
import { useDividendHistory } from "@/hooks/useDividendHistory";
import StockList from "@/components/StockList";
import StockTable from "@/components/StockTable";
import IndexCards from "@/components/IndexCards";
import AlertRuleForm from "@/components/AlertRuleForm";
import AlertRuleList from "@/components/AlertRuleList";
import RefreshTimer from "@/components/RefreshTimer";
import DividendCalculator from "@/components/DividendCalculator";
import PortfolioPanel from "@/components/PortfolioPanel";
import { DEFAULT_WATCHLIST, DEFAULT_REFRESH_INTERVAL } from "@/lib/constants";
import type { StockCode, StockData, IndexData, ViewMode } from "@/lib/types";

const { Title, Text } = Typography;

export default function Home() {
  const [watchlist, setWatchlist] = useLocalStorage<StockCode[]>("ts-stock-monitor:watchlist", DEFAULT_WATCHLIST);
  const [newCode, setNewCode] = useLocalStorage("ts-stock-monitor:newCode", "");
  const [refreshInterval, setRefreshInterval] = useLocalStorage("ts-stock-monitor:refreshInterval", DEFAULT_REFRESH_INTERVAL);
  const [showAlertPanel, setShowAlertPanel] = useLocalStorage("ts-stock-monitor:showAlertPanel", false);
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>("ts-stock-monitor:viewMode", "table");
  const [showCalculator, setShowCalculator] = useLocalStorage("ts-stock-monitor:showCalculator", false);
  const [showPortfolio, setShowPortfolio] = useLocalStorage("ts-stock-monitor:showPortfolio", false);

  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);

  const { data, loading, error, refetch, lastUpdated } = useStockData(watchlist);
  const { rules, triggers, addRule, removeRule, toggleRule, evaluate } = useAlerts();
  const { trades: insiderTrades } = useInsiderData(watchlist);
  const { data: dividendHistory } = useDividendHistory(watchlist);

  const fetchIndices = useCallback(async () => {
    setIndicesLoading(true);
    try {
      const res = await fetch("/api/stocks?codes=000001,399006");
      const json = await res.json();
      if (json.success) {
        const items: IndexData[] = (json.data ?? []).map((d: StockData) => ({
          quote: {
            code: d.quote.code,
            name: d.quote.code === "000001" ? "上证指数" : "创业板指",
            currentPrice: d.quote.currentPrice, prevClose: d.quote.prevClose,
            changePercent: d.quote.changePercent, changeAmount: d.quote.changeAmount,
            high: d.quote.high, low: d.quote.low, volume: d.quote.volume, amount: d.quote.amount, timestamp: d.quote.timestamp,
          },
          fearGauge: d.fearGauge ?? { overall: 50, drawdown: 50, rsi: 50, macd: 50, label: "中性 😐" },
        }));
        setIndices(items);
      }
    } catch {} finally { setIndicesLoading(false); }
  }, []);

  useEffect(() => { fetchIndices(); }, [fetchIndices]);

  const dataMap = useMemo(() => {
    const m = new Map<string, StockData>();
    data.forEach((i) => m.set(i.quote.code, i));
    return m;
  }, [data]);

  useEffect(() => { evaluate(dataMap); }, [dataMap, evaluate]);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => { refetch(); fetchIndices(); }, refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, refetch, fetchIndices]);

  const addStock = useCallback(() => {
    const code = newCode.trim();
    if (!code) return;
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6 || watchlist.includes(clean)) return;
    setWatchlist((prev) => [...prev, clean]);
    setNewCode("");
  }, [newCode, watchlist, setWatchlist, setNewCode]);

  const removeStock = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((c) => c !== code));
  }, [setWatchlist]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 48px" }}>
      {/* ═══ 头部 ═══ */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0, letterSpacing: "-0.32px", fontWeight: 600 }}>📊 A 股量化看板</Title>
          <Text type="secondary" style={{ fontSize: 13, marginTop: 2, display: "block" }}>实时行情 · 基本面 · 智能预警</Text>
        </div>
        <Flex gap={8} align="center">
          <Button type={viewMode === "table" ? "primary" : "default"} size="small" icon={<TableOutlined />} onClick={() => setViewMode("table")}>表格</Button>
          <Button type={viewMode === "card" ? "primary" : "default"} size="small" icon={<AppstoreOutlined />} onClick={() => setViewMode("card")}>卡片</Button>
          <Badge count={triggers.length} size="small" offset={[2, -2]}>
            <Button type={showAlertPanel ? "primary" : "default"} size="small" icon={<BellOutlined />} onClick={() => setShowAlertPanel(!showAlertPanel)}>预警</Button>
          </Badge>
          <Button type={showCalculator ? "primary" : "default"} size="small" icon={<CalculatorOutlined />} onClick={() => setShowCalculator(!showCalculator)}>定投</Button>
          <Button type={showPortfolio ? "primary" : "default"} size="small" icon={<WalletOutlined />} onClick={() => setShowPortfolio(!showPortfolio)}>持仓</Button>
        </Flex>
      </Flex>

      {/* ═══ 大盘指数 ═══ */}
      <IndexCards indices={indices} loading={indicesLoading} />

      {/* ═══ 定投计算器 ═══ */}
      {showCalculator && <section style={{ marginBottom: 16 }}><DividendCalculator /></section>}

      {/* ═══ 持仓管理 ═══ */}
      {showPortfolio && (
        <section style={{ marginBottom: 16 }}>
          <PortfolioPanel stockDataMap={dataMap} />
        </section>
      )}

      {/* ═══ 预警面板 ═══ */}
      {showAlertPanel && (
        <section style={{ marginBottom: 16 }}>
          <AlertRuleForm onAdd={addRule} />
          <div style={{ marginTop: 12 }}><AlertRuleList rules={rules} onToggle={toggleRule} onRemove={removeRule} /></div>
          {triggers.length > 0 && (
            <div style={{ marginTop: 12, borderRadius: 8, background: "#fffbeb", padding: 12, boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#d97706", marginBottom: 6 }}>🔔 当前触发的告警 ({triggers.length})</div>
              {triggers.map((t, i) => (
                <div key={i} style={{ borderRadius: 6, background: "#fff", padding: "4px 10px", marginBottom: 4, boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.06)" }}>
                  <Text strong>{t.stockName}</Text>
                  <Text type="secondary" style={{ margin: "0 4px" }}>-</Text>
                  <Text style={{ color: "#d97706" }}>{t.ruleLabel}</Text>
                  <Text type="secondary" style={{ margin: "0 4px" }}>→</Text>
                  <Text code style={{ fontSize: 12 }}>{typeof t.currentValue === 'number' ? t.currentValue.toFixed(2) : t.currentValue}</Text>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ═══ 自选股管理 ═══ */}
      <section style={{ marginBottom: 12 }}>
        <Flex wrap="wrap" gap={8} align="center">
          <Input placeholder="输入 6 位代码，如 600519" value={newCode} onChange={(e) => setNewCode(e.target.value)} onPressEnter={addStock} style={{ width: 200 }} size="small" allowClear />
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addStock} disabled={!newCode.trim()}>添加</Button>
          <Flex wrap="wrap" gap={4}>
            {watchlist.map((code) => (
              <Tag key={code} closable onClose={() => removeStock(code)} style={{ fontFamily: "var(--font-geist-mono)", borderRadius: 9999 }}>{code}</Tag>
            ))}
          </Flex>
          {!loading && data.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>{data.length} / {watchlist.length} 只</Text>
          )}
        </Flex>
      </section>

      {/* ═══ 刷新控制 ═══ */}
      <section style={{ marginBottom: 16 }}>
        <RefreshTimer interval={refreshInterval} onIntervalChange={setRefreshInterval} lastUpdated={lastUpdated} onRefresh={() => { refetch(); fetchIndices(); }} loading={loading} />
      </section>

      {/* ═══ 告警横幅 ═══ */}
      {triggers.length > 0 && !showAlertPanel && (
        <section style={{ marginBottom: 12 }}>
          <div style={{ borderRadius: 8, background: "#fffbeb", padding: "8px 16px", boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}>
            <Flex align="center" justify="space-between">
              <Text style={{ fontSize: 14, fontWeight: 500, color: "#d97706" }}>🔔 {triggers.length} 条告警触发</Text>
              <Button type="link" size="small" onClick={() => setShowAlertPanel(true)} style={{ fontSize: 13 }}>查看详情 →</Button>
            </Flex>
          </div>
        </section>
      )}

      {/* ═══ 个股展示 ═══ */}
      {viewMode === "table" ? (
        <StockTable data={data} triggers={triggers} loading={loading} error={error} insiderTrades={insiderTrades} dividendHistory={dividendHistory} />
      ) : (
        <StockList data={data} triggers={triggers} loading={loading} error={error} insiderTrades={insiderTrades} dividendHistory={dividendHistory} />
      )}
    </div>
  );
}
