"use client";

import { Flex } from "antd";
import {
  WalletOutlined, GiftOutlined,
} from "@ant-design/icons";
import type { StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";
import { getExchangeRate } from "@/lib/stockUtils";
import { useState, useEffect } from "react";

interface PortfolioMiniCardProps {
  stockDataMap: Map<string, StockData>;
}

const fmtMoney = (v: number): string => {
  if (v >= 10000) return "¥" + (v / 10000).toFixed(1) + "万";
  return "¥" + v.toLocaleString("zh-CN");
};

export default function PortfolioMiniCard({ stockDataMap }: PortfolioMiniCardProps) {
  const { summary, positions } = usePortfolio(stockDataMap);

  // 如果 localStorage 没数据，从服务端加载
  const [serverPositions, setServerPositions] = useState<any[]>([]);
  useEffect(() => {
    if (positions.length === 0) {
      fetch('/api/portfolio')
        .then(r => r.json())
        .then(res => {
          if (res.success && Array.isArray(res.data)) {
            setServerPositions(res.data);
          }
        })
        .catch(() => {});
    }
  }, [positions.length]);

  // 决定使用哪组数据
  const effectivePositions = positions.length > 0 ? positions : serverPositions;

  if (effectivePositions.length === 0) return null;

  // 直接从持仓数据计算，不依赖 summary
  let totalInvested = 0;
  let totalMarketValue = 0;
  let totalDividends = 0;
  let annualDividendIncome = 0;

  for (const pos of effectivePositions) {
    const stockCode = pos.stockCode || pos.code;
    const totalCost = pos.totalCost || pos.cost;
    const buyPrice = pos.buyPrice || pos.price;
    
    const sd = stockDataMap.get(stockCode);
    const yield_ = sd?.fundamentals.dividendYield;
    const currentPrice = sd?.quote.currentPrice ?? buyPrice;
    const exchangeRate = getExchangeRate(stockCode);
    
    const invested = totalCost * pos.shares * exchangeRate;
    const marketValue = currentPrice * pos.shares * exchangeRate;
    const dividends = (pos.dividends || []).reduce((s: number, d: any) => s + d.total, 0) * exchangeRate;
    
    totalInvested += invested;
    totalMarketValue += marketValue;
    totalDividends += dividends;
    
    if (yield_ != null && yield_ > 0) {
      annualDividendIncome += marketValue * (yield_ / 100);
    }
  }

  const totalProfit = totalMarketValue + totalDividends - totalInvested;
  const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const dividendYieldOnCost = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;
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
        boxShadow: "var(--card-shadow)",
      }}
    >
      {/* 标题 */}
      <Flex justify="space-between" align="center">
        <span style={{ fontWeight: 500, fontSize: 14, color: "var(--text-primary)" }}>
          📦 组合收益
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 9999,
            background: isProfit ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            color: isProfit ? "#22c55e" : "#ef4444",
            fontWeight: 500,
          }}
        >
          {isProfit ? "+" : ""}{totalProfitPct.toFixed(2)}%
        </span>
      </Flex>

      {/* 收益额 */}
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

      {/* 明细指标 */}
      <Flex justify="space-between" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-secondary)" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>投入</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            {fmtMoney(totalInvested)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>成本股息率</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: dividendYieldOnCost > 5 ? "#16a34a" : "var(--text-primary)" }}>
            {dividendYieldOnCost.toFixed(1)}%
          </div>
        </div>
      </Flex>

      <Flex justify="space-between" style={{ marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>持股市值</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            {fmtMoney(totalMarketValue)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>年化分红</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#d97706" }}>
            {annualDividendIncome >= 10000
              ? "¥" + (annualDividendIncome / 10000).toFixed(1) + "万"
              : "¥" + annualDividendIncome.toFixed(0)}
          </div>
        </div>
      </Flex>
    </div>
  );
}
