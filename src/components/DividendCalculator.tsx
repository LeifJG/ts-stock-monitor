// ============================================================
// DividendCalculator.tsx — 股息定投计算器（Vercel 风格）
// ============================================================

"use client";

import { useState, useMemo } from "react";
import { InputNumber, Table, Flex, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

const { Text } = Typography;

interface YearRow {
  year: number;
  startValue: number;
  totalInvested: number;
  yearlyInvestment: number;
  dividendIncome: number;
  endValue: number;
  totalReturn: number;
  annualReturn: number;
}

function simulate(
  principal: number, monthlyDca: number, divYield: number,
  divGrowth: number, years: number, priceAppreciation: number,
): YearRow[] {
  const rows: YearRow[] = [];
  let value = principal, totalInvested = principal, currentDivYield = divYield;

  for (let y = 1; y <= years; y++) {
    const startValue = value;
    const yearlyInvestment = monthlyDca * 12;
    totalInvested += yearlyInvestment;
    value += yearlyInvestment;
    const avgValue = (startValue + value) / 2;
    const dividendIncome = avgValue * (currentDivYield / 100);
    value = value * (1 + priceAppreciation / 100) + dividendIncome;
    const totalReturn = value - totalInvested;
    const annualReturn = value > 0 ? ((value / totalInvested) ** (1 / y) - 1) * 100 : 0;

    rows.push({
      year: y, startValue: Math.round(startValue * 100) / 100,
      totalInvested: Math.round(totalInvested * 100) / 100,
      yearlyInvestment: Math.round(yearlyInvestment * 100) / 100,
      dividendIncome: Math.round(dividendIncome * 100) / 100,
      endValue: Math.round(value * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      annualReturn: Math.round(annualReturn * 100) / 100,
    });
    currentDivYield = divYield * (1 + divGrowth / 100) ** y;
  }
  return rows;
}

function cny(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + "万";
  return v.toFixed(2);
}

const COLUMNS: ColumnsType<YearRow> = [
  { title: "年份", dataIndex: "year", key: "year", render: (y) => `第${y}年`, width: 70 },
  { title: "年初市值", dataIndex: "startValue", key: "startValue", render: (v) => cny(v), width: 110 },
  { title: "当年投入", dataIndex: "yearlyInvestment", key: "yearlyInvestment", render: (v) => cny(v), width: 110 },
  { title: "股息收入", dataIndex: "dividendIncome", key: "dividendIncome", render: (v) => <span style={{ color: "#d97706" }}>{cny(v)}</span>, width: 110 },
  { title: "年末市值", dataIndex: "endValue", key: "endValue", render: (v) => <span style={{ color: "#171717", fontWeight: 600 }}>{cny(v)}</span>, width: 120 },
  { title: "累计投入", dataIndex: "totalInvested", key: "totalInvested", render: (v) => cny(v), width: 110 },
  { title: "累计回报", dataIndex: "totalReturn", key: "totalReturn", render: (v) => <span style={{ color: v >= 0 ? "#16a34a" : "#ef4444" }}>{v >= 0 ? "+" : ""}{cny(v)}</span>, width: 120 },
  { title: "年化收益", dataIndex: "annualReturn", key: "annualReturn", render: (v) => (
    <span style={{ color: v >= 15 ? "#16a34a" : v >= 0 ? "#171717" : "#ef4444", fontWeight: v >= 15 ? 600 : 400 }}>{v.toFixed(2)}%</span>
  ), width: 100 },
];

export default function DividendCalculator() {
  const [principal, setPrincipal] = useState(100000);
  const [monthlyDca, setMonthlyDca] = useState(5000);
  const [divYield, setDivYield] = useState(4);
  const [divGrowth, setDivGrowth] = useState(3);
  const [priceGrowth, setPriceGrowth] = useState(3);
  const [years, setYears] = useState(10);

  const rows = useMemo(() => simulate(principal, monthlyDca, divYield, divGrowth, years, priceGrowth), [principal, monthlyDca, divYield, divGrowth, years, priceGrowth]);

  const last = rows[rows.length - 1];
  const totalDividends = rows.reduce((s, r) => s + r.dividendIncome, 0);

  const summaryItems = [
    { label: "总投入", value: cny(last.totalInvested) },
    { label: "终值", value: cny(last.endValue), color: "#171717" },
    { label: "总回报", value: cny(last.totalReturn), color: last.totalReturn >= 0 ? "#16a34a" : "#ef4444" },
    { label: "年化收益率", value: `${last.annualReturn.toFixed(2)}%`, color: last.annualReturn >= 15 ? "#16a34a" : "#171717", bold: last.annualReturn >= 15 },
    { label: "累计股息", value: cny(totalDividends), color: "#d97706" },
    { label: "股息占比", value: `${(totalDividends / last.endValue * 100).toFixed(1)}%`, color: "#d97706" },
    { label: "投入产出比", value: `${(last.endValue / last.totalInvested).toFixed(2)}x`, color: "#7c3aed" },
    { label: "月均收益", value: cny(last.totalReturn / (years * 12)) },
  ];

  return (
    <div style={{ borderRadius: 8, padding: 20, background: "#fff", boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.32px", marginBottom: 16, color: "#171717" }}>📈 股息定投计算器</div>

      {/* 输入区 */}
      <Flex wrap="wrap" gap={12} style={{ marginBottom: 20 }}>
        {[
          { label: "初始本金(元)", value: principal, set: setPrincipal, step: 10000, min: 0, max: 1e8 },
          { label: "每月定投(元)", value: monthlyDca, set: setMonthlyDca, step: 1000, min: 0, max: 1e7 },
          { label: "年股息率(%)", value: divYield, set: setDivYield, step: 0.5, min: 0, max: 20 },
          { label: "股息年增长(%)", value: divGrowth, set: setDivGrowth, step: 0.5, min: 0, max: 30 },
          { label: "股价年增长(%)", value: priceGrowth, set: setPriceGrowth, step: 0.5, min: -10, max: 30 },
          { label: "投资年限", value: years, set: setYears, step: 1, min: 1, max: 50 },
        ].map((f) => (
          <div key={f.label} style={{ flex: "1 0 120px", minWidth: 120 }}>
            <div style={{ fontSize: 12, color: "#808080", marginBottom: 4 }}>{f.label}</div>
            <InputNumber value={f.value} onChange={(v) => v != null && f.set(v)} step={f.step} min={f.min} max={f.max} style={{ width: "100%" }} size="small" />
          </div>
        ))}
      </Flex>

      {/* 总结卡片 */}
      <Flex wrap="wrap" gap={10} style={{ marginBottom: 16 }}>
        {summaryItems.map((s) => (
          <div key={s.label} style={{ flex: "1 0 100px", minWidth: 100, borderRadius: 6, padding: "10px 12px", background: "#fafafa", boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 11, color: "#808080", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: s.bold ? 600 : 500, color: s.color ?? "#4d4d4d", letterSpacing: "-0.16px" }}>{s.value}</div>
          </div>
        ))}
      </Flex>

      {/* 逐年表 */}
      <Table dataSource={rows} columns={COLUMNS} rowKey="year" pagination={false} size="small" style={{ fontSize: 13 }} />

      {/* 免责 */}
      <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12, color: "#bfbfbf", lineHeight: 1.6 }}>
        ⚠️ 以上计算为简化模型，假设收益率为恒定值，未考虑税费和交易成本。实际收益受市场波动影响。
      </Text>
    </div>
  );
}
