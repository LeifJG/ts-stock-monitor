"use client";

import { useState, useEffect } from "react";
import { Flex } from "antd";
import type { StockData } from "@/lib/types";
import { getExchangeRate } from "@/lib/stockUtils";

interface PortfolioMiniCardProps {
  stockDataMap: Map<string, StockData>;
}

const fmtMoney = (v: number): string => {
  if (v >= 10000) return "¥" + (v / 10000).toFixed(1) + "万";
  return "¥" + v.toLocaleString("zh-CN");
};

export default function PortfolioMiniCard({ stockDataMap }: PortfolioMiniCardProps) {
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/portfolio")
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setPositions(data.data);
        }
      })
      .catch(() => {});
  }, []);

  if (positions.length === 0) return null;

  let totalInvested = 0;
  let totalMarketValue = 0;
  let totalProfit = 0;
  let annualDividendIncome = 0;

  for (const pos of positions) {
    const stockCode = pos.code || pos.stockCode;
    const cost = pos.cost || pos.totalCost;
    const price = pos.price || pos.buyPrice;
    const shares = pos.shares || 0;

    const exchangeRate = getExchangeRate(stockCode);
    const sd = stockDataMap.get(stockCode);
    const currentPrice = sd?.quote.currentPrice ?? price;
    const dividendYield = sd?.fundamentals.dividendYield;

    const invested = shares * cost * exchangeRate;
    const marketValue = shares * currentPrice * exchangeRate;
    const profit = marketValue - invested;

    totalInvested += invested;
    totalMarketValue += marketValue;
    totalProfit += profit;

    if (dividendYield != null && dividendYield > 0) {
      annualDividendIncome += marketValue * (dividendYield / 100);
    }
  }

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
        background: "#1a1a1a",
        border: "1px solid #333",
        color: "#fff",
      }}
    >
      <Flex justify="space-between" align="center">
        <span style={{ fontWeight: 500, fontSize: 14, color: "#fff" }}>
          📦 组合收益
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 9999,
            background: isProfit ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
            color: isProfit ? "#22c55e" : "#ef4444",
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
            color: isProfit ? "#22c55e" : "#ef4444",
            letterSpacing: "-0.48px",
          }}
        >
          {fmtMoney(Math.abs(totalProfit))}
        </span>
      </div>

      <Flex justify="space-between" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #333" }}>
        <div>
          <div style={{ fontSize: 11, color: "#999" }}>投入</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>
            {fmtMoney(totalInvested)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#999" }}>成本股息率</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: dividendYieldOnCost > 5 ? "#22c55e" : "#fff" }}>
            {dividendYieldOnCost.toFixed(1)}%
          </div>
        </div>
      </Flex>

      <Flex justify="space-between" style={{ marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 11, color: "#999" }}>持股市值</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>
            {fmtMoney(totalMarketValue)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#999" }}>年化分红</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#f59e0b" }}>
            {annualDividendIncome >= 10000
              ? "¥" + (annualDividendIncome / 10000).toFixed(1) + "万"
              : "¥" + annualDividendIncome.toFixed(0)}
          </div>
        </div>
      </Flex>
    </div>
  );
}
