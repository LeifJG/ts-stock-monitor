// ============================================================
// PortfolioMiniCard.tsx — 首页顶部「组合收益」小卡片
// ------------------------------------------------------------
// 数据源与组合面板完全一致：usePortfolio（localStorage）
// + 实时行情自动合并（含港股），计算统一走 portfolio-calc，
// 保证与「组合收益总览」数字强关联、永不打架。
// ============================================================

"use client";

import { Flex } from "antd";
import type { StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";

interface PortfolioMiniCardProps {
  stockDataMap: Map<string, StockData>;
}

const fmtMoney = (v: number): string => {
  if (v >= 10000) return "¥" + (v / 10000).toFixed(1) + "万";
  return "¥" + v.toLocaleString("zh-CN");
};

export default function PortfolioMiniCard({ stockDataMap }: PortfolioMiniCardProps) {
  const { summary } = usePortfolio(stockDataMap);

  if (summary.positionCount === 0) return null;

  const totalProfit = summary.totalProfit;
  const totalProfitPct = summary.totalProfitPct;
  const isProfit = totalProfit >= 0;

  return (
    <div
      style={{
        flex: "1 1 200px",
        maxWidth: 260,
        minWidth: 180,
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        color: "var(--text-primary)",
      }}
    >
      <Flex justify="space-between" align="center">
        <span style={{ fontWeight: 500, fontSize: 14, color: "var(--text-primary)" }}>
          📦 组合收益
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 9999,
            background: isProfit ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
            color: isProfit ? "var(--green)" : "var(--red)",
            fontWeight: 500,
          }}
        >
          {isProfit ? "+" : ""}{totalProfitPct.toFixed(2)}%
        </span>
      </Flex>

      <div style={{ marginTop: 4 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: isProfit ? "var(--green)" : "var(--red)",
            letterSpacing: "-0.48px",
          }}
        >
          {fmtMoney(Math.abs(totalProfit))}
        </span>
      </div>

      <Flex justify="space-between" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-color)" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>投入</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            {fmtMoney(summary.totalInvested)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>成本股息率</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: summary.dividendYieldOnCost > 5 ? "var(--green)" : "var(--text-primary)" }}>
            {summary.dividendYieldOnCost.toFixed(1)}%
          </div>
        </div>
      </Flex>

      <Flex justify="space-between" style={{ marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>持股市值</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            {fmtMoney(summary.totalMarketValue)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>年化分红</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--gold)" }}>
            {summary.annualDividendIncome >= 10000
              ? "¥" + (summary.annualDividendIncome / 10000).toFixed(1) + "万"
              : "¥" + summary.annualDividendIncome.toFixed(0)}
          </div>
        </div>
      </Flex>
    </div>
  );
}
