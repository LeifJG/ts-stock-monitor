"use client";

import { useState, useEffect } from 'react';
import { getExchangeRate } from '@/lib/stockUtils';
import type { StockData } from '@/lib/types';

export default function PortfolioMiniCard({ stockDataMap }: { stockDataMap: Map<string, StockData> }) {
  const [positions, setPositions] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(res => {
        if (res.success && Array.isArray(res.data)) {
          setPositions(res.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">📦 组合收益</h3>
      <div className="text-gray-500">加载中...</div>
    </div>
  );

  if (positions.length === 0) return null;

  // 直接从 portfolio.json 数据计算
  let totalInvested = 0;
  let totalMarketValue = 0;
  let totalDividends = 0;
  let annualDividendIncome = 0;

  for (const pos of positions) {
    const stockCode = pos.code || pos.stockCode;
    const costPerShare = pos.cost || pos.totalCost;
    const shares = pos.shares;
    const exchangeRate = getExchangeRate(stockCode);

    // 投入 = 成本价 × 股数 × 汇率
    const invested = costPerShare * shares * exchangeRate;
    totalInvested += invested;

    // 市值 = 当前价 × 股数 × 汇率
    const sd = stockDataMap.get(stockCode);
    const currentPrice = sd?.quote.currentPrice ?? pos.price ?? costPerShare;
    const marketValue = currentPrice * shares * exchangeRate;
    totalMarketValue += marketValue;

    // 分红（如果有）
    const dividends = (pos.dividends || []).reduce((s: number, d: any) => s + (d.total || d.amount || 0), 0) * exchangeRate;
    totalDividends += dividends;

    // 年化分红
    const yield_ = sd?.fundamentals.dividendYield;
    if (yield_ != null && yield_ > 0) {
      annualDividendIncome += marketValue * (yield_ / 100);
    }
  }

  const totalProfit = totalMarketValue + totalDividends - totalInvested;
  const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const costYield = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;
  const isProfit = totalProfit >= 0;

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-semibold">📦 组合收益</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isProfit ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
          {isProfit ? '+' : ''}{totalProfitPct.toFixed(2)}%
        </span>
      </div>

      <div className={`text-2xl font-bold mb-3 ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
        {isProfit ? '+' : ''}¥{Math.abs(totalProfit).toFixed(2)}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">投入:</span>
          <span className="font-mono">¥{totalInvested.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">持股市值:</span>
          <span className="font-mono">¥{totalMarketValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">年化分红:</span>
          <span className="font-mono text-yellow-500">¥{annualDividendIncome.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">成本股息率:</span>
          <span className={`font-mono ${costYield > 5 ? 'text-green-400' : ''}`}>{costYield.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}