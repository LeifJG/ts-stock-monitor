// ============================================================
// src/app/page.tsx — 主页面（新功能：指数 + 表格 + 排序 + 增减持）
// ============================================================
// 自选股、刷新间隔、告警规则、视图模式均自动保存到 localStorage。

"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useStockData } from "@/hooks/useStockData";
import { useAlerts } from "@/hooks/useAlerts";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import StockList from "@/components/StockList";
import StockTable from "@/components/StockTable";
import IndexCards from "@/components/IndexCards";
import AlertRuleForm from "@/components/AlertRuleForm";
import AlertRuleList from "@/components/AlertRuleList";
import RefreshTimer from "@/components/RefreshTimer";
import DividendCalculator from "@/components/DividendCalculator";
import { DEFAULT_WATCHLIST, DEFAULT_REFRESH_INTERVAL } from "@/lib/constants";
import type { StockCode, StockData, IndexData, ViewMode } from "@/lib/types";

export default function Home() {
  // ── 持久化状态 ──────────────────────────────────────────────────
  const [watchlist, setWatchlist] = useLocalStorage<StockCode[]>(
    "ts-stock-monitor:watchlist", DEFAULT_WATCHLIST
  );
  const [newCode, setNewCode] = useLocalStorage("ts-stock-monitor:newCode", "");
  const [refreshInterval, setRefreshInterval] = useLocalStorage(
    "ts-stock-monitor:refreshInterval", DEFAULT_REFRESH_INTERVAL
  );
  const [showAlertPanel, setShowAlertPanel] = useLocalStorage(
    "ts-stock-monitor:showAlertPanel", false
  );
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "ts-stock-monitor:viewMode", "table"
  );
  const [showCalculator, setShowCalculator] = useLocalStorage(
    "ts-stock-monitor:showCalculator", false
  );

  // ── 非持久化状态 ────────────────────────────────────────────────
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);

  // ── 数据 Hook ──────────────────────────────────────────────────
  const { data, loading, error, refetch, lastUpdated } = useStockData(watchlist);
  const { rules, triggers, addRule, removeRule, toggleRule, evaluate } = useAlerts();

  // ── 获取大盘指数（单独请求） ────────────────────────────────────
  const fetchIndices = useCallback(async () => {
    setIndicesLoading(true);
    try {
      const res = await fetch("/api/stocks?codes=000001,399006");
      const json = await res.json();
      if (json.success) {
        // 从 stock 数据格式转换为 IndexData 格式
        const items: IndexData[] = (json.data ?? []).map((d: StockData) => ({
          quote: {
            code: d.quote.code,
            name: d.quote.code === "000001" ? "上证指数" : "创业板指",
            currentPrice: d.quote.currentPrice,
            prevClose: d.quote.prevClose,
            changePercent: d.quote.changePercent,
            changeAmount: d.quote.changeAmount,
            high: d.quote.high,
            low: d.quote.low,
            volume: d.quote.volume,
            amount: d.quote.amount,
            timestamp: d.quote.timestamp,
          },
          fearGauge: d.fearGauge ?? { overall: 50, drawdown: 50, rsi: 50, macd: 50, label: "中性 😐" },
        }));
        setIndices(items);
      }
    } catch {
      // 静默失败
    } finally {
      setIndicesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndices();
  }, [fetchIndices]);

  // ── 数据 → Map，供告警引擎使用 ──────────────────────────────────
  const dataMap = useMemo(() => {
    const map = new Map<string, StockData>();
    data.forEach((item) => map.set(item.quote.code, item));
    return map;
  }, [data]);

  // ── 数据更新时评估告警 ──────────────────────────────────────────
  useEffect(() => {
    evaluate(dataMap);
  }, [dataMap, evaluate]);

  // ── 定时刷新（个股 + 指数一起） ─────────────────────────────────
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        refetch();
        fetchIndices();
      }, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, refetch, fetchIndices]);

  // ── 添加/删除股票 ──────────────────────────────────────────────
  const addStock = useCallback(() => {
    const code = newCode.trim();
    if (!code) return;
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6) return;
    if (watchlist.includes(clean)) return;
    setWatchlist((prev) => [...prev, clean]);
    setNewCode("");
  }, [newCode, watchlist, setWatchlist, setNewCode]);

  const removeStock = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((c) => c !== code));
    if (watchlist.length <= 1) {
      // 最后一只被删除时清空
    }
  }, [setWatchlist]);

  const handleIntervalChange = useCallback((sec: number) => {
    setRefreshInterval(sec);
  }, [setRefreshInterval]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* ═══ 顶部标题 ═══ */}
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📊 A 股量化看板</h1>
          <p className="mt-0.5 text-sm text-gray-400">实时行情 · 基本面 · 智能预警</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 transition ${viewMode === "table" ? "bg-blue-500 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >表格</button>
            <button
              onClick={() => setViewMode("card")}
              className={`px-3 py-1.5 transition ${viewMode === "card" ? "bg-blue-500 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >卡片</button>
          </div>
          {/* 预警按钮 */}
          <button
            onClick={() => setShowAlertPanel(!showAlertPanel)}
            className={`relative rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              showAlertPanel ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            预警
            {triggers.length > 0 && (
              <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white">
                {triggers.length}
              </span>
            )}
          </button>
          {/* 定投计算器按钮 */}
          <button
            onClick={() => setShowCalculator(!showCalculator)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              showCalculator ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            📈 定投
          </button>
        </div>
      </header>

      {/* ═══ 大盘指数 ═══ */}
      <IndexCards indices={indices} loading={indicesLoading} />

      {/* ═══ 定投计算器 ═══ */}
      {showCalculator && (
        <section className="mb-4">
          <DividendCalculator />
        </section>
      )}

      {/* ═══ 预警面板 ═══ */}
      {showAlertPanel && (
        <section className="mb-4 space-y-3">
          <AlertRuleForm onAdd={addRule} />
          <AlertRuleList rules={rules} onToggle={toggleRule} onRemove={removeRule} />
          {triggers.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <h3 className="mb-1.5 text-sm font-bold text-amber-700">🔔 当前触发的告警 ({triggers.length})</h3>
              <div className="space-y-1">
                {triggers.map((t, i) => (
                  <div key={i} className="rounded-lg bg-white px-3 py-1.5 text-xs shadow-sm">
                    <span className="font-medium">{t.stockName}</span>
                    <span className="mx-1 text-gray-400">-</span>
                    <span className="text-amber-600">{t.ruleLabel}</span>
                    <span className="mx-1 text-gray-300">→</span>
                    <span className="font-mono text-gray-800">{typeof t.currentValue === 'number' ? t.currentValue.toFixed(2) : t.currentValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ 自选股管理 ═══ */}
      <section className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="输入 6 位代码，如 600519"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addStock()}
            className="w-52 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
          />
          <button
            onClick={addStock}
            disabled={!newCode.trim()}
            className="rounded-lg bg-blue-500 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + 添加
          </button>

          <div className="flex flex-wrap gap-1">
            {watchlist.map((code) => (
              <span key={code} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                {code}
                <button onClick={() => removeStock(code)} className="text-gray-400 hover:text-red-500">✕</button>
              </span>
            ))}
          </div>

          {!loading && data.length > 0 && (
            <span className="ml-auto text-xs text-gray-400">
              {data.length} / {watchlist.length} 只
            </span>
          )}
        </div>
      </section>

      {/* ═══ 刷新控制 ═══ */}
      <section className="mb-4">
        <RefreshTimer
          interval={refreshInterval}
          onIntervalChange={handleIntervalChange}
          lastUpdated={lastUpdated}
          onRefresh={() => { refetch(); fetchIndices(); }}
          loading={loading}
        />
      </section>

      {/* ═══ 告警横幅 ═══ */}
      {triggers.length > 0 && !showAlertPanel && (
        <section className="mb-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-700">🔔 {triggers.length} 条告警触发</span>
              <button onClick={() => setShowAlertPanel(true)} className="text-xs text-blue-500 hover:text-blue-600">查看详情 →</button>
            </div>
          </div>
        </section>
      )}

      {/* ═══ 个股展示（表格/卡片） ═══ */}
      {viewMode === "table" ? (
        <StockTable data={data} triggers={triggers} loading={loading} error={error} />
      ) : (
        <StockList data={data} triggers={triggers} loading={loading} error={error} />
      )}
    </div>
  );
}
