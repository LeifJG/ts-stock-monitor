// ============================================================
// src/app/page.tsx — 主页面（Vercel 风格）
// ============================================================

"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { Button, Input, Tag, Flex, Badge, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useStockData } from "@/hooks/useStockData";
import { useAlerts } from "@/hooks/useAlerts";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useInsiderData } from "@/hooks/useInsiderData";
import { useDividendHistory } from "@/hooks/useDividendHistory";
import { useAlertSync } from "@/hooks/useAlertSync";
import { useValuationData } from "@/hooks/useValuationData";
import { useFxRate } from "@/hooks/useFxRate";
import { usePortfolio } from "@/hooks/usePortfolio";
import StockList from "@/components/StockList";
import StockTable from "@/components/StockTable";
import IndexCards from "@/components/IndexCards";
import AppHeader from "@/components/AppHeader";
import AlertRuleForm from "@/components/AlertRuleForm";
import AlertRuleList from "@/components/AlertRuleList";
import RefreshTimer from "@/components/RefreshTimer";
import DividendCalculator from "@/components/DividendCalculator";
import PortfolioPanel from "@/components/PortfolioPanel";
import PortfolioSummary from "@/components/PortfolioSummary";
import PortfolioAdvice from "@/components/PortfolioAdvice";
import IndustryDiversity from "@/components/IndustryDiversity";
import DividendCalendar from "@/components/DividendCalendar";
import GridTradingPanel from "@/components/GridTradingPanel";
import DataManager from "@/components/DataManager";
import DailyReport from "@/components/DailyReport";
import PortfolioMiniCard from "@/components/PortfolioMiniCard";
import StockScreener from "@/components/StockScreener";
import { lazy, Suspense } from "react";

const TradingNotes = lazy(() => import("@/components/TradingNotes"));
import { computeAllScores, applyFilters, type ScreenerFilters } from "@/lib/scorer";
import { DEFAULT_FILTERS } from "@/lib/scorer";
import { DEFAULT_WATCHLIST, DEFAULT_REFRESH_INTERVAL } from "@/lib/constants";
import type { StockCode, StockData, IndexData, ViewMode } from "@/lib/types";

export default function Home() {
  useFxRate(); // P1-5：注入实时港币汇率（静默失败回退 0.86）
  const [watchlist, setWatchlist] = useLocalStorage<StockCode[]>("ts-stock-monitor:watchlist", DEFAULT_WATCHLIST);
  const [newCode, setNewCode] = useLocalStorage("ts-stock-monitor:newCode", "");
  const [refreshInterval, setRefreshInterval] = useLocalStorage("ts-stock-monitor:refreshInterval", DEFAULT_REFRESH_INTERVAL);
  const [showAlertPanel, setShowAlertPanel] = useLocalStorage("ts-stock-monitor:showAlertPanel", false);
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>("ts-stock-monitor:viewMode", "table");
  const [showCalculator, setShowCalculator] = useLocalStorage("ts-stock-monitor:showCalculator", false);
  const [showPortfolio, setShowPortfolio] = useLocalStorage("ts-stock-monitor:showPortfolio", false);
  const [showCalendar, setShowCalendar] = useLocalStorage("ts-stock-monitor:showCalendar", false);
  const [showIndustry, setShowIndustry] = useLocalStorage("ts-stock-monitor:showIndustry", false);
  const [showGrid, setShowGrid] = useLocalStorage("ts-stock-monitor:showGrid", false);
  const [showReport, setShowReport] = useLocalStorage("ts-stock-monitor:showReport", false);
  const [showNotes, setShowNotes] = useState(false);
  const [screenerFilters, setScreenerFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS);
  const [showScore, setShowScore] = useState(true); // 评分列常态化展示

  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);

  const { positions } = usePortfolio(); // 只读持仓清单：用于合并进自选展示

  // ── 统一清单：自选 ∪ 持仓（持仓股默认自动进自选，展示层合并不写 localStorage，
  //    银河同步增删持仓时表格自动跟随，不会残留） ──────────────────
  const allCodes = useMemo(() => {
    const set = new Set(watchlist);
    for (const p of positions) {
      if (p.stockCode) set.add(p.stockCode);
    }
    return Array.from(set);
  }, [watchlist, positions]);
  const portfolioOnlyCodes = useMemo(
    () => new Set(allCodes.filter((c) => !watchlist.includes(c))),
    [allCodes, watchlist]
  );

  const { data, loading, error, refetch, lastUpdated } = useStockData(allCodes);
  const { rules, triggers, addRule, removeRule, toggleRule, evaluate } = useAlerts();
  useAlertSync(rules);

  const { trades: insiderTrades } = useInsiderData(allCodes);
  const { data: dividendHistory } = useDividendHistory(allCodes);
  const { data: valuationData } = useValuationData(allCodes);

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

  // ── 综合评分（含估值分位维度，与交易建议引擎口径一致） ──────
  const scores = useMemo(
    () => computeAllScores(data, valuationData),
    [data, valuationData]
  );

  // ── 筛选后数据 ────────────────────────────────────────────
  const filteredCodes = useMemo(
    () => applyFilters(data, scores, screenerFilters),
    [data, scores, screenerFilters]
  );
  const filteredData = useMemo(
    () => data.filter((s) => filteredCodes.has(s.quote.code)),
    [data, filteredCodes]
  );
  const activeFilterCount = Object.values(screenerFilters).filter((v) => v != null).length;

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
    let clean = code.replace(/\D/g, "");
    if (clean.length >= 1 && clean.length < 5) clean = clean.padStart(5, "0"); // 港股短码补零：700→00700
    // A股6位，港股通5位
    const validLen = clean.length === 5 || clean.length === 6;
    if (!validLen || allCodes.includes(clean)) return; // 已在自选或持仓中
    setWatchlist((prev) => [...prev, clean]);
    setNewCode("");
  }, [newCode, allCodes, setWatchlist, setNewCode]);

  const removeStock = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((c) => c !== code));
  }, [setWatchlist]);

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 24px 48px" }}>
      {/* ═══ 头部（重构：分组下拉） ═══ */}
      <AppHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showAlertPanel={showAlertPanel}
        onAlertPanelToggle={() => setShowAlertPanel(!showAlertPanel)}
        showCalculator={showCalculator}
        onCalculatorToggle={() => setShowCalculator(!showCalculator)}
        showPortfolio={showPortfolio}
        onPortfolioToggle={() => setShowPortfolio(!showPortfolio)}
        showCalendar={showCalendar}
        onCalendarToggle={() => setShowCalendar(!showCalendar)}
        showIndustry={showIndustry}
        onIndustryToggle={() => setShowIndustry(!showIndustry)}
        showGrid={showGrid}
        onGridToggle={() => setShowGrid(!showGrid)}
        showReport={showReport}
        onReportToggle={() => setShowReport(true)}
        showNotes={showNotes}
        onNotesToggle={() => setShowNotes(!showNotes)}
        triggerCount={triggers.length}
        onSyncClick={() => setShowPortfolio(!showPortfolio)}
      />

      {/* ═══ 大盘指数 + 组合收益（并排） ═══ */}
      <Flex gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
        <IndexCards indices={indices} loading={indicesLoading} />
        <PortfolioMiniCard stockDataMap={dataMap} />
      </Flex>

      {/* ═══ 定投计算器 ═══ */}
      {showCalculator && <section style={{ marginBottom: 16 }}><DividendCalculator /></section>}

      {/* ═══ 持仓管理 ═══ */}
      {showPortfolio && (
        <section style={{ marginBottom: 16 }}>
          <PortfolioSummary stockDataMap={dataMap} />
          <div style={{ marginTop: 12 }}>
            <PortfolioAdvice stockDataMap={dataMap} />
          </div>
          <div style={{ marginTop: 12 }}>
            <PortfolioPanel stockDataMap={dataMap} />
          </div>
        </section>
      )}

      {/* ═══ 分红日历 ═══ */}
      {showCalendar && (
        <section style={{ marginBottom: 16 }}>
          <DividendCalendar watchlist={allCodes} />
        </section>
      )}

      {/* ═══ 行业分散度 ═══ */}
      {showIndustry && (
        <section style={{ marginBottom: 16 }}>
          <IndustryDiversity watchlist={allCodes} />
        </section>
      )}

      {/* ═══ 网格交易 ═══ */}
      {showGrid && (
        <section style={{ marginBottom: 16 }}>
          <GridTradingPanel stockDataMap={dataMap} />
        </section>
      )}

      {/* ═══ 收盘日报（弹窗）═══ */}
      <DailyReport open={showReport} onClose={() => setShowReport(false)} />

      {/* ═══ 交易笔记（弹窗）═══ */}
      <TradingNotes open={showNotes} onClose={() => setShowNotes(false)} />

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
                  <strong>{t.stockName}</strong>
                  <span style={{ color: "#808080", margin: "0 4px" }}>-</span>
                  <span style={{ color: "#d97706" }}>{t.ruleLabel}</span>
                  <span style={{ color: "#808080", margin: "0 4px" }}>→</span>
                  <code style={{ fontSize: 12, background: "#f5f5f5", padding: "0 4px", borderRadius: 3 }}>{typeof t.currentValue === 'number' ? t.currentValue.toFixed(2) : t.currentValue}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ═══ 自选股管理 ═══ */}
      <section style={{ marginBottom: 12 }}>
        <Flex wrap="wrap" gap={8} align="center">
          <Input placeholder="输入代码：A股6位 / 港股5位，如 00700" value={newCode} onChange={(e) => setNewCode(e.target.value)} onPressEnter={addStock} style={{ width: 240 }} size="small" allowClear />
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addStock} disabled={!newCode.trim()}>添加</Button>
          <Flex wrap="wrap" gap={4}>
            {allCodes.map((code) => {
              const fromPortfolio = portfolioOnlyCodes.has(code); // 仅持仓来源：不可移除（去持仓面板管理）
              return (
                <Tag
                  key={code}
                  closable={!fromPortfolio}
                  onClose={() => removeStock(code)}
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    borderRadius: 9999,
                    ...(fromPortfolio ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}),
                  }}
                >
                  {fromPortfolio && <span style={{ marginRight: 2 }}>💼</span>}{code}
                </Tag>
              );
            })}
          </Flex>
          {!loading && data.length > 0 && (
            <span style={{ color: "var(--text-tertiary)", fontSize: 12, marginLeft: "auto" }}>{data.length} / {allCodes.length} 只</span>
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
              <span style={{ fontSize: 14, fontWeight: 500, color: "#d97706" }}>🔔 {triggers.length} 条告警触发</span>
              <Button type="link" size="small" onClick={() => setShowAlertPanel(true)} style={{ fontSize: 13 }}>查看详情 →</Button>
            </Flex>
          </div>
        </section>
      )}

      {/* ═══ 智能筛选 ═══ */}
      <StockScreener
        filters={screenerFilters}
        onChange={setScreenerFilters}
        activeCount={activeFilterCount > 0 ? filteredData.length : data.length}
        totalCount={data.length}
      />

      {/* ═══ 个股展示 ═══ */}
      {viewMode === "table" ? (
        <StockTable
          data={activeFilterCount > 0 ? filteredData : data}
          triggers={triggers}
          loading={loading}
          error={error}
          insiderTrades={insiderTrades}
          dividendHistory={dividendHistory}
          valuationData={valuationData}
          scores={scores}
          showScore={showScore}
          onToggleScore={() => setShowScore(!showScore)}
        />
      ) : (
        <StockList data={data} triggers={triggers} loading={loading} error={error} insiderTrades={insiderTrades} dividendHistory={dividendHistory} />
      )}
    </div>
  );
}
