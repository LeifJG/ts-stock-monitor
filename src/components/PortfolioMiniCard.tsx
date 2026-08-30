"use client";

import { useState, useEffect } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { getExchangeRate } from '@/lib/stockUtils';
import type { StockData } from '@/lib/types';

export default function PortfolioMiniCard({ stockDataMap }: { stockDataMap: Map<string, StockData> }) {
  const { positions, summary } = usePortfolio(stockDataMap);
  const [logs, setLogs] = useState<string[]>([]);

  // 计算年化分红收入（考虑汇率）
  let annualDividendIncome = 0;
  for (const pos of positions) {
    const stockCode = pos.stockCode || pos.code;
    if (!stockCode) continue;
    
    const sd = stockDataMap.get(stockCode);
    const yield_ = sd?.fundamentals.dividendYield;
    
    if (yield_ != null && yield_ > 0) {
      const currentPrice = sd?.quote.currentPrice ?? pos.buyPrice ?? pos.price ?? 0;
      const exchangeRate = getExchangeRate(stockCode);
      const marketValue = pos.shares * currentPrice * exchangeRate;
      annualDividendIncome += marketValue * (yield_ / 100);
    }
  }

  // 成本股息率
  const costYield = summary.totalInvested > 0 
    ? (annualDividendIncome / summary.totalInvested) * 100
    : 0;

  useEffect(() => {
    const logMessage = `[PORTFOLIO_LOG] positions=${JSON.stringify(positions.map(p => ({
      code: p.stockCode || p.code,
      shares: p.shares,
      cost: p.totalCost || p.cost,
      price: p.buyPrice || p.price
    })))} totalInvested=${summary.totalInvested} totalMarketValue=${summary.totalMarketValue} totalDividends=${summary.totalDividends} totalProfit=${summary.totalProfit}`;
    console.log(logMessage);
    setLogs(prev => [...prev.slice(-4), logMessage]);
  }, [positions, summary]);

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">组合收益</h3>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>投入:</span>
          <span className="font-mono">{summary.totalInvested.toFixed(2)}</span>
        </div>
        
        <div className="flex justify-between">
          <span>持股市值:</span>
          <span className="font-mono">{summary.totalMarketValue.toFixed(2)}</span>
        </div>
        
        <div className="flex justify-between">
          <span>组合收益:</span>
          <span className={`font-mono ${summary.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {summary.totalProfit.toFixed(2)} ({summary.totalProfitPct.toFixed(2)}%)
          </span>
        </div>
        
        <div className="flex justify-between">
          <span>年化分红:</span>
          <span className="font-mono">{annualDividendIncome.toFixed(2)}</span>
        </div>
        
        <div className="flex justify-between">
          <span>成本股息率:</span>
          <span className="font-mono">{costYield.toFixed(2)}%</span>
        </div>
      </div>
      
      {/* 调试日志 */}
      {logs.length > 0 && (
        <div className="mt-4 p-2 bg-black text-xs font-mono text-green-400 rounded">
          <div className="text-gray-500 mb-1">调试日志:</div>
          {logs.map((log, i) => (
            <div key={i} className="truncate">{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}