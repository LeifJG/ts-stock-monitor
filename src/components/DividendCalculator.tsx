// ============================================================
// DividendCalculator.tsx — 股息定投计算器
// ============================================================
// 模拟长期定投 + 股息再投资的复利效果。
// 支持输入：本金、每月定投、股息率、股息年增长率、投资年限。
// 输出：逐年明细表 + 投资总结。

"use client";

import { useState, useMemo } from "react";

// ─── 类型 ─────────────────────────────────────────────────────

interface YearRow {
  year: number;
  startValue: number;    // 年初市值
  totalInvested: number; // 累计投入（年初时）
  yearlyInvestment: number; // 当年投入（定投12个月）
  dividendIncome: number;   // 当年股息收入
  endValue: number;         // 年末市值（股息复投后）
  totalReturn: number;      // 累计总回报
  annualReturn: number;     // 当年收益率
}

// ─── 计算引擎 ─────────────────────────────────────────────────

function simulate(
  principal: number,       // 初始本金
  monthlyDca: number,      // 每月定投
  divYield: number,        // 年化股息率 (%)
  divGrowth: number,       // 股息年增长率 (%)
  years: number,           // 投资年限
  priceAppreciation: number // 年化股价涨幅 (%)
): YearRow[] {
  const rows: YearRow[] = [];

  let value = principal;          // 当前市值
  let totalInvested = principal;  // 累计投入
  let currentDivYield = divYield; // 当年股息率

  for (let y = 1; y <= years; y++) {
    const startValue = value;
    const yearlyInvestment = monthlyDca * 12;
    totalInvested += yearlyInvestment;

    // 年中投入（简化：年初投入全年定投）
    value += yearlyInvestment;

    // 股息收入 = 年初市值 × 股息率（考虑股息再投资，用平均市值）
    const avgValue = (startValue + value) / 2;
    const dividendIncome = avgValue * (currentDivYield / 100);

    // 股价增长 + 股息复投
    value = value * (1 + priceAppreciation / 100) + dividendIncome;

    // 总回报 = 当前市值 + 已收到股息 - 总投入
    const totalReturn = value - totalInvested;

    // 年化收益率
    const annualReturn = value > 0
      ? ((value / totalInvested) ** (1 / y) - 1) * 100
      : 0;

    rows.push({
      year: y,
      startValue: Math.round(startValue * 100) / 100,
      totalInvested: Math.round(totalInvested * 100) / 100,
      yearlyInvestment: Math.round(yearlyInvestment * 100) / 100,
      dividendIncome: Math.round(dividendIncome * 100) / 100,
      endValue: Math.round(value * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      annualReturn: Math.round(annualReturn * 100) / 100,
    });

    // 股息率逐年增长
    currentDivYield = divYield * (1 + divGrowth / 100) ** y;
  }

  return rows;
}

// ─── 格式化 ───────────────────────────────────────────────────

function cny(v: number): string {
  if (Math.abs(v) >= 1e4) {
    return (v / 1e4).toFixed(2) + "万";
  }
  return v.toFixed(2);
}

function cnyShort(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return v.toFixed(0);
}

// ─── 组件 ─────────────────────────────────────────────────────

export default function DividendCalculator() {
  const [principal, setPrincipal] = useState(100000);     // 初始本金 10万
  const [monthlyDca, setMonthlyDca] = useState(5000);     // 每月定投 5000
  const [divYield, setDivYield] = useState(4);            // 股息率 4%
  const [divGrowth, setDivGrowth] = useState(3);          // 股息年增长 3%
  const [priceGrowth, setPriceGrowth] = useState(3);      // 股价年增长 3%
  const [years, setYears] = useState(10);                 // 投资年限 10年

  const rows = useMemo(
    () => simulate(principal, monthlyDca, divYield, divGrowth, years, priceGrowth),
    [principal, monthlyDca, divYield, divGrowth, years, priceGrowth]
  );

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1];
    return {
      totalInvested: last.totalInvested,
      finalValue: last.endValue,
      totalReturn: last.totalReturn,
      annualReturn: last.annualReturn,
      totalDividends: rows.reduce((s, r) => s + r.dividendIncome, 0),
    };
  }, [rows]);

  // ── 渲染 ──

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-bold text-gray-900">📈 股息定投计算器</h2>

      {/* 输入区域 */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <InputField label="初始本金(元)" value={principal} onChange={setPrincipal} step={10000} />
        <InputField label="每月定投(元)" value={monthlyDca} onChange={setMonthlyDca} step={1000} />
        <InputField label="年股息率(%)" value={divYield} onChange={setDivYield} step={0.5} min={0} max={20} />
        <InputField label="股息年增长(%)" value={divGrowth} onChange={setDivGrowth} step={0.5} min={0} max={30} />
        <InputField label="股价年增长(%)" value={priceGrowth} onChange={setPriceGrowth} step={0.5} min={-10} max={30} />
        <InputField label="投资年限" value={years} onChange={setYears} step={1} min={1} max={50} />
      </div>

      {/* 总结卡片 */}
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="总投入" value={cnyShort(summary.totalInvested)} color="text-gray-700" />
          <SummaryCard label="终值" value={cnyShort(summary.finalValue)} color="text-blue-600" />
          <SummaryCard label="总回报" value={cnyShort(summary.totalReturn)} color={summary.totalReturn >= 0 ? "text-green-600" : "text-red-600"} />
          <SummaryCard label="年化收益率" value={summary.annualReturn.toFixed(2) + "%"} color={summary.annualReturn >= 8 ? "text-green-600 font-bold" : summary.annualReturn >= 0 ? "text-blue-600" : "text-red-600"} />
          <SummaryCard label="累计股息" value={cnyShort(summary.totalDividends)} color="text-amber-600" />
          <SummaryCard label="股息占比" value={(summary.totalDividends / summary.finalValue * 100).toFixed(1) + "%"} color="text-amber-600" />
          <SummaryCard label="投入产出比" value={(summary.finalValue / summary.totalInvested).toFixed(2) + "x"} color="text-purple-600" />
          <SummaryCard label="月均收益" value={cnyShort(summary.totalReturn / (years * 12))} color="text-gray-600" />
        </div>
      )}

      {/* 逐年明细表 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <Th>年份</Th>
              <Th>年初市值</Th>
              <Th>当年投入</Th>
              <Th>股息收入</Th>
              <Th>年末市值</Th>
              <Th>累计投入</Th>
              <Th>累计回报</Th>
              <Th>年化收益</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-b border-gray-100 transition hover:bg-gray-50">
                <td className="px-2 py-1.5 font-medium text-gray-500">第{r.year}年</td>
                <td className="px-2 py-1.5 font-mono">{cny(r.startValue)}</td>
                <td className="px-2 py-1.5 font-mono">{cny(r.yearlyInvestment)}</td>
                <td className="px-2 py-1.5 font-mono text-amber-600">{cny(r.dividendIncome)}</td>
                <td className="px-2 py-1.5 font-mono font-medium text-blue-600">{cny(r.endValue)}</td>
                <td className="px-2 py-1.5 font-mono text-gray-500">{cny(r.totalInvested)}</td>
                <td className={`px-2 py-1.5 font-mono ${r.totalReturn >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {r.totalReturn >= 0 ? "+" : ""}{cny(r.totalReturn)}
                </td>
                <td className={`px-2 py-1.5 font-mono ${r.annualReturn >= 8 ? "text-green-600 font-bold" : r.annualReturn >= 0 ? "text-blue-600" : "text-red-500"}`}>
                  {r.annualReturn.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 免责提示 */}
      <p className="mt-3 text-xs text-gray-400">
        ⚠️ 以上计算为简化模型，假设股息率/增长率为恒定值，未考虑税费和交易成本。实际收益受市场波动影响。
      </p>
    </div>
  );
}

// ─── 子组件 ───────────────────────────────────────────────────

function InputField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-xs text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        step={step}
        min={min}
        max={max}
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1.5 text-xs font-medium text-gray-500">
      {children}
    </th>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`mt-0.5 text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}
