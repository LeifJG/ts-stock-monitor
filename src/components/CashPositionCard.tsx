// ============================================================
// CashPositionCard.tsx — 可用现金与仓位分析
// ------------------------------------------------------------
// 解决的问题：系统原来只认股票，不知道手上还有多少现金，
// 于是「仓位」没法分析（满仓跌 30% 和 60% 仓位跌 30% 是两回事），
// 也没法回答「现在该不该用现金、留多少」。
//
// 现金存在服务端 data/cash.json（跟持仓一样，不依赖浏览器 localStorage）
// 数据来源：
//   /api/cash          → 手工录入的可用现金
//   /api/cash-bond     → 沪深300 估值分位 + 逆回购利率（决定保留区间与停泊收益）
//   /api/portfolio-advice → 折价标的数量（决定「先补哪几只」的措辞）
// ============================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, InputNumber, Button, Tag, Space, message, Spin, Typography } from "antd";
import { WalletOutlined, SaveOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { usePortfolio } from "@/hooks/usePortfolio";
import { buildCashPlan, cashRatio } from "@/lib/cash-plan";
import type { StockData } from "@/lib/types";

const { Text } = Typography;

const fmtMoney = (v: number): string =>
  Math.abs(v) >= 10000
    ? `¥${(v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}万`
    : `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;

const LEVEL_STYLE: Record<string, { color: string; text: string }> = {
  short: { color: "red", text: "弹药不足" },
  ok: { color: "green", text: "仓位健康" },
  excess: { color: "gold", text: "现金富余" },
};

interface Props {
  stockDataMap: Map<string, StockData>;
}

export default function CashPositionCard({ stockDataMap }: Props) {
  const { summary } = usePortfolio(stockDataMap);
  const [cash, setCash] = useState<number | null>(null);
  const [recorded, setRecorded] = useState(false);   // 是否真的录入过（区分「0 元」和「没填过」）
  // 用户刚保存过就不要被 started 前发出的 GET 结果覆盖（cash-bond/advice 慢时会发生竞态）
  const userSavedRef = useRef(false);
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketPct, setMarketPct] = useState<number | null>(null);
  const [parkingRate, setParkingRate] = useState<number | null>(null);
  const [cheapCount, setCheapCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [cRes, bRes, aRes] = await Promise.allSettled([
        fetch("/api/cash", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/cash-bond", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/portfolio-advice", { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (cRes.status === "fulfilled" && cRes.value?.success) {
        if (userSavedRef.current) return;   // 已保存过，忽略这次可能更旧的读结果
        const amt = Number(cRes.value.data?.amount ?? 0);
        setCash(amt);
        setDraft(amt);
        setRecorded(Boolean(cRes.value.data?.updatedAt));
      }
      if (bRes.status === "fulfilled" && bRes.value?.success) {
        const d = bRes.value.data;
        const hs300 = (d?.erp ?? []).find((e: { code: string }) => e.code === "000300");
        setMarketPct(hs300?.pePct5y ?? null);
        const gc = d?.repo?.GC007?.rate ?? d?.repo?.GC001?.rate ?? null;
        setParkingRate(typeof gc === "number" ? gc : null);
      }
      if (aRes.status === "fulfilled" && aRes.value?.success) {
        const advice = aRes.value?.data?.advice ?? [];
        const cheap = advice.filter((a: { fairValuePremiumPct?: number | null }) =>
          a.fairValuePremiumPct != null && a.fairValuePremiumPct < -5).length;
        setCheapCount(cheap);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stockValue = summary.totalMarketValue;
  const plan = useMemo(
    () => buildCashPlan({ cash: cash ?? 0, stockValue, marketPct, parkingRate, cheapHoldingCount: cheapCount }),
    [cash, stockValue, marketPct, parkingRate, cheapCount]
  );

  const save = async () => {
    if (draft == null || draft < 0) {
      message.warning("请输入非负的现金金额");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: draft }),
      });
      const j = await r.json();
      if (j.success) {
        userSavedRef.current = true;
        setCash(j.data.amount);
        setRecorded(Boolean(j.data?.updatedAt));
        message.success("可用现金已保存");
      } else {
        message.error(j.error ?? "保存失败");
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card size="small" title="💵 可用现金与仓位">
        <div style={{ padding: 16, textAlign: "center" }}><Spin /></div>
      </Card>
    );
  }

  const ratio = cashRatio(cash ?? 0, stockValue);
  const total = (cash ?? 0) + stockValue;
  const lv = LEVEL_STYLE[plan.level];

  return (
    <Card
      size="small"
      title={<span><WalletOutlined /> 可用现金与仓位</span>}
      extra={recorded ? <Tag color={lv.color}>{lv.text}</Tag> : <Tag color="default">未录入</Tag>}
    >
      {/* ── 录入 ── */}
      <Space wrap style={{ marginBottom: 12 }}>
        <Text type="secondary">可用现金</Text>
        <InputNumber
          value={draft}
          onChange={setDraft}
          min={0}
          step={1000}
          style={{ width: 160 }}
          formatter={(v) => (v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "")}
          parser={(v) => Number((v ?? "").replace(/,/g, ""))}
          addonAfter="元"
        />
        <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} onClick={save}>
          保存
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          存在服务端 data/cash.json，清缓存不会丢
        </Text>
      </Space>

      {/* ── 仓位概览 ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: "1 1 150px", border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 12px", background: "#fafafa" }}>
          <div style={{ fontSize: 12, color: "#888" }}>现金占比</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: plan.level === "short" ? "#cf1322" : plan.level === "excess" ? "#d48806" : "#389e0d" }}>
            {ratio == null ? "--" : `${ratio}%`}
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>建议 {plan.band.min}–{plan.band.max}%</div>
        </div>
        <div style={{ flex: "1 1 150px", border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 12px", background: "#fafafa" }}>
          <div style={{ fontSize: 12, color: "#888" }}>股票市值</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(stockValue)}</div>
          <div style={{ fontSize: 11, color: "#888" }}>港股市值已折人民币</div>
        </div>
        <div style={{ flex: "1 1 150px", border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 12px", background: "#fafafa" }}>
          <div style={{ fontSize: 12, color: "#888" }}>总资产（股+现金）</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(total)}</div>
          <div style={{ fontSize: 11, color: "#888" }}>仓位分析的分母</div>
        </div>
      </div>

      {/* ── 结论 ── */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {recorded ? plan.headline : "还没录入可用现金（当前按 0 计）——填一个数才能算真实的仓位与弹药"}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
        <InfoCircleOutlined /> {plan.band.label}
        {marketPct != null ? `（市场分位取自沪深300 PE）` : ""}
      </div>

      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
        {plan.actions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>

      {plan.gapToMin > 0 && (
        <div style={{ fontSize: 12, color: "#cf1322", marginTop: 8 }}>
          距建议下限还差 {fmtMoney(plan.gapToMin)}（要么补现金，要么把高估标的减一点）
        </div>
      )}
      {plan.excessAboveMax > 0 && (
        <div style={{ fontSize: 12, color: "#d48806", marginTop: 8 }}>
          超出建议上限 {fmtMoney(plan.excessAboveMax)}，这部分闲钱应该去逆回购/货基或分批建仓
        </div>
      )}
    </Card>
  );
}
