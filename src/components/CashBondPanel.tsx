// ============================================================
// CashBondPanel.tsx — 现金与股债比面板
// ------------------------------------------------------------
// 回答三个问题：
//   1. 债券现在贵不贵（10Y 收益率在历史什么位置）
//   2. 闲钱放哪里（逆回购 / 场内货基 / 短融，能随时变现金）
//   3. 股票相对债券还有没有吸引力（ERP = 盈利收益率 − 10Y 国债）
// 数据：/api/cash-bond（bond_data.py + 中证指数 PE 缓存）
// ============================================================

"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Table, Tag, Tooltip, Empty, Spin, Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { bondPositionVerdict, erpVerdict, priceImpactIfRateUp1Pct } from "@/lib/erp";

interface YieldItem {
  value: number;
  pct_5y?: number;
  pct_10y?: number;
  date?: string;
  min_5y?: number;
  max_5y?: number;
}
interface RepoItem {
  code: string;
  desc: string;
  rate: number;
}
interface EtfItem {
  code: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  changePct: number;
  note: string;
  lossIfRateUp1pct: number;
}
interface ErpItem {
  code: string;
  name: string;
  etf?: string;
  pe: number;
  earningsYield: number | null;
  erp: number | null;
  pePct5y: number | null;
}
interface CashBondData {
  generatedAt: string | null;
  yields: Record<string, YieldItem>;
  repo: Record<string, RepoItem>;
  etfs: EtfItem[];
  bond10y: number | null;
  erp: ErpItem[];
}

const LEVEL_COLOR: Record<string, string> = { good: "green", neutral: "gold", bad: "red" };

const catColor: Record<string, string> = {
  货币: "default",
  短久期: "blue",
  中久期: "cyan",
  长久期: "orange",
  超长久期: "volcano",
  转债: "purple",
};

export default function CashBondPanel() {
  const [data, setData] = useState<CashBondData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/cash-bond${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (j.success) setData(j.data);
      else setErr(j.error ?? "加载失败");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <Card size="small" title="💰 现金与股债比">
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin /> <span style={{ marginLeft: 8, color: "#888" }}>首次抓取国债收益率约 10 秒…</span>
        </div>
      </Card>
    );
  }
  if (err && !data) {
    return (
      <Card size="small" title="💰 现金与股债比" extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => load(true)}>重试</Button>}>
        <Empty description={`数据加载失败：${err}`} />
      </Card>
    );
  }
  if (!data) return null;

  const y = data.yields;
  const d10 = y.d10;
  const v10 = bondPositionVerdict(d10?.pct_5y);

  // 收益率卡片
  const yieldCards: Array<{ key: string; label: string; item?: YieldItem }> = [
    { key: "d2", label: "2 年国债", item: y.d2 },
    { key: "d10", label: "10 年国债", item: y.d10 },
    { key: "d30", label: "30 年国债", item: y.d30 },
  ];

  return (
    <Card
      size="small"
      title="💰 现金与股债比"
      extra={
        <span style={{ fontSize: 12, color: "#888" }}>
          {data.generatedAt ? `数据 ${data.generatedAt.slice(0, 16).replace("T", " ")}` : ""}
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => load(true)} style={{ marginLeft: 6 }} />
        </span>
      }
    >
      {/* ── 债券位置 ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {yieldCards.map(({ key, label, item }) => {
          const v = bondPositionVerdict(item?.pct_5y);
          return (
            <div
              key={key}
              style={{
                flex: "1 1 180px", border: "1px solid #f0f0f0", borderRadius: 8, padding: "10px 12px",
                background: "#fafafa",
              }}
            >
              <div style={{ fontSize: 12, color: "#888" }}>{label}收益率</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>
                {item ? item.value.toFixed(2) : "--"}
                <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 2 }}>%</span>
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                近5年分位 {item?.pct_5y != null ? `${item.pct_5y}%` : "--"}
                {item?.min_5y != null && item?.max_5y != null ? ` · 区间 ${item.min_5y}~${item.max_5y}%` : ""}
              </div>
              <Tag color={LEVEL_COLOR[v.level]} style={{ marginTop: 6 }}>{v.label}</Tag>
            </div>
          );
        })}
        {/* 逆回购 */}
        <div style={{ flex: "1 1 220px", border: "1px solid #f0f0f0", borderRadius: 8, padding: "10px 12px", background: "#f6ffed" }}>
          <div style={{ fontSize: 12, color: "#888" }}>闲钱停泊（国债逆回购，年化）</div>
          <div style={{ marginTop: 4 }}>
            {Object.entries(data.repo).map(([name, r]) => (
              <div key={name} style={{ fontSize: 13 }}>
                <b>{name}</b> <span style={{ color: "#888", fontSize: 12 }}>{r.desc}</span>{" "}
                <span style={{ color: "#389e0d", fontWeight: 600 }}>{r.rate.toFixed(2)}%</span>
              </div>
            ))}
            {!Object.keys(data.repo).length && <span style={{ color: "#888" }}>--</span>}
          </div>
        </div>
      </div>

      {d10 && (
        <div style={{ fontSize: 12, color: v10.level === "bad" ? "#cf1322" : "#666", marginBottom: 12 }}>
          10 年国债收益率 {d10.value}%，处于近 5 年 <b>{d10.pct_5y ?? "--"}%</b> 分位（10 年 {d10.pct_10y ?? "--"}% 分位）。
          {v10.level === "bad"
            ? "利率已在历史低位 → 长债继续上涨的空间有限、上行风险大，此时买长债 ETF 是赌降息，不是防守。"
            : "债券仍有一定票息价值，长债久期风险需自行承担。"}
        </div>
      )}

      {/* ── 股债性价比 ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>
        股债性价比（ERP = 盈利收益率 − 10 年国债收益率）
      </div>
      <Table<ErpItem>
        size="small"
        rowKey="code"
        pagination={false}
        dataSource={data.erp}
        columns={[
          { title: "指数", dataIndex: "name", width: 110 },
          { title: "PE", dataIndex: "pe", width: 80, render: (v: number) => v.toFixed(2) },
          { title: "盈利收益率", dataIndex: "earningsYield", width: 110, render: (v: number | null) => (v == null ? "--" : `${v.toFixed(2)}%`) },
          {
            title: "ERP", dataIndex: "erp", width: 100, sorter: (a, b) => (a.erp ?? -99) - (b.erp ?? -99),
            render: (v: number | null) => v == null ? "--" : <b style={{ color: v >= 5 ? "#389e0d" : v >= 0 ? "#d48806" : "#cf1322" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</b>,
          },
          {
            title: "PE 5年分位", dataIndex: "pePct5y", width: 110,
            render: (v: number | null) => (v == null ? "--" : `${v}%`),
          },
          {
            title: "判断", dataIndex: "erp", key: "verdict", width: 130,
            render: (v: number | null) => {
              const vd = erpVerdict(v);
              return <Tag color={LEVEL_COLOR[vd.level]}>{vd.label}</Tag>;
            },
          },
        ]}
      />

      {/* ── 债券工具箱 ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 6px" }}>
        可买的债券类工具（久期决定利率敏感度）
      </div>
      <Table<EtfItem>
        size="small"
        rowKey="code"
        pagination={false}
        dataSource={data.etfs}
        columns={[
          { title: "代码", dataIndex: "code", width: 90 },
          { title: "名称", dataIndex: "name", width: 110 },
          {
            title: "类型", dataIndex: "category", width: 90,
            render: (v: string) => <Tag color={catColor[v] ?? "default"}>{v}</Tag>,
          },
          { title: "现价", dataIndex: "price", width: 90, render: (v: number) => v.toFixed(3) },
          { title: "今日", dataIndex: "changePct", width: 80, render: (v: number) => <span style={{ color: v > 0 ? "#cf1322" : v < 0 ? "#389e0d" : "#888" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}%</span> },
          {
            title: "久期(年)", dataIndex: "duration", width: 90,
            render: (v: number) => <Tooltip title="久期越大，利率变动对价格影响越大">{v}</Tooltip>,
          },
          {
            title: "利率↑1%价格", key: "rateUp", width: 120,
            render: (_: unknown, row: EtfItem) => {
              const impact = priceImpactIfRateUp1Pct(row.duration);
              if (impact == null) return "--";
              return (
                <span style={{ color: impact <= -8 ? "#cf1322" : impact <= -3 ? "#d48806" : "#389e0d" }}>
                  {impact.toFixed(1)}%
                </span>
              );
            },
          },
          { title: "说明", dataIndex: "note", ellipsis: true },
        ]}
      />

      <div style={{ fontSize: 12, color: "#888", marginTop: 10 }}>
        久期为静态估算（×年期国债 ETF 跟踪标的久期），仅用于提示利率敏感度；逆回购收益按实时报价，节假日前通常冲高。
      </div>
    </Card>
  );
}
