// ============================================================
// src/app/page.tsx — 主页面
// ============================================================
// 组装所有组件：自选股管理、定时刷新、告警面板、股票卡片列表。

"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useStockData } from "@/hooks/useStockData";
import { useAlerts } from "@/hooks/useAlerts";
import StockList from "@/components/StockList";
import AlertRuleForm from "@/components/AlertRuleForm";
import AlertRuleList from "@/components/AlertRuleList";
import RefreshTimer from "@/components/RefreshTimer";
import { DEFAULT_WATCHLIST, DEFAULT_REFRESH_INTERVAL } from "@/lib/constants";
import type { StockCode, StockData } from "@/lib/types";

export default function Home() {
  // ── 状态 ────────────────────────────────────────────────────
  const [watchlist, setWatchlist] = useState<StockCode[]>(DEFAULT_WATCHLIST);
  const [newCode, setNewCode] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(DEFAULT_REFRESH_INTERVAL);
  const [showAlertPanel, setShowAlertPanel] = useState(false);

  // ── 数据 ────────────────────────────────────────────────────
  const { data, loading, error, refetch, lastUpdated } = useStockData(watchlist);
  const { rules, triggers, addRule, removeRule, toggleRule, evaluate } = useAlerts();

  // ── 数据 → Map，供告警引擎使用 ──────────────────────────────
  const dataMap = useMemo(() => {
    const map = new Map<string, StockData>();
    data.forEach((item) => map.set(item.quote.code, item));
    return map;
  }, [data]);

  // ── 数据更新时评估告警 ──────────────────────────────────────
  useEffect(() => {
    evaluate(dataMap);
  }, [dataMap, evaluate]);

  // ── 定时刷新 ────────────────────────────────────────────────
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(refetch, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, refetch]);

  // ── 添加股票 ────────────────────────────────────────────────
  const addStock = useCallback(() => {
    const code = newCode.trim();
    if (!code) return;
    // 只保留数字
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6) return;
    if (watchlist.includes(clean)) return;
    setWatchlist((prev) => [...prev, clean]);
    setNewCode("");
  }, [newCode, watchlist]);

  const removeStock = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((c) => c !== code));
  }, []);

  // ── 刷新间隔变更 ────────────────────────────────────────────
  const handleIntervalChange = useCallback((sec: number) => {
    setRefreshInterval(sec);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* ── 顶部标题 ────────────────────────────────────────── */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📊 A 股量化看板</h1>
          <p className="mt-1 text-sm text-gray-400">
            实时行情 · 基本面 · 智能预警
          </p>
        </div>
        <button
          onClick={() => setShowAlertPanel(!showAlertPanel)}
          className={`relative rounded-lg px-4 py-2 text-sm font-medium transition ${
            showAlertPanel
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          预警规则
          {triggers.length > 0 && (
            <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white">
              {triggers.length}
            </span>
          )}
        </button>
      </header>

      {/* ── 预警面板 ────────────────────────────────────────── */}
      {showAlertPanel && (
        <section className="mb-6 space-y-4">
          <AlertRuleForm onAdd={addRule} />
          <AlertRuleList
            rules={rules}
            onToggle={toggleRule}
            onRemove={removeRule}
          />

          {/* 当前触发告警 */}
          {triggers.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="mb-2 text-sm font-bold text-amber-700">
                🔔 当前触发的告警 ({triggers.length})
              </h3>
              <div className="space-y-1">
                {triggers.map((t, i) => (
                  <div key={i} className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
                    <span className="font-medium">{t.stockName}</span>
                    <span className="mx-1.5 text-gray-400">-</span>
                    <span className="text-amber-600">{t.ruleLabel}</span>
                    <span className="mx-1.5 text-gray-300">→</span>
                    <span className="font-mono text-gray-800">{t.currentValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 自选股管理 ──────────────────────────────────────── */}
      <section className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="输入 6 位股票代码，如 600519"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addStock()}
            className="w-56 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <button
            onClick={addStock}
            disabled={!newCode.trim()}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + 添加
          </button>

          <div className="ml-2 flex flex-wrap gap-1.5">
            {watchlist.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600"
              >
                {code}
                <button
                  onClick={() => removeStock(code)}
                  className="ml-0.5 text-gray-400 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          {!loading && data.length > 0 && (
            <span className="ml-auto text-xs text-gray-400">
              显示 {data.length} / {watchlist.length} 只股票
            </span>
          )}
        </div>
      </section>

      {/* ── 刷新控制 ────────────────────────────────────────── */}
      <section className="mb-6">
        <RefreshTimer
          interval={refreshInterval}
          onIntervalChange={handleIntervalChange}
          lastUpdated={lastUpdated}
          onRefresh={refetch}
          loading={loading}
        />
      </section>

      {/* ── 告警横幅 ────────────────────────────────────────── */}
      {triggers.length > 0 && !showAlertPanel && (
        <section className="mb-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-700">
                🔔 {triggers.length} 条告警触发
              </span>
              <button
                onClick={() => setShowAlertPanel(true)}
                className="text-sm text-blue-500 hover:text-blue-600"
              >
                查看详情 →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── 股票卡片列表 ────────────────────────────────────── */}
      <StockList data={data} triggers={triggers} loading={loading} error={error} />
    </div>
  );
}
