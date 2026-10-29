// ============================================================
// BiasChecklist.tsx — 下单前偏误自检
// ------------------------------------------------------------
// 放在「操作建议」下面：看完了建议、准备动手之前，先过这四问。
// 四问来自《思考，快与慢》：锚定 / 叙事谬误 / 损失厌恶·禀赋效应 / 过度自信。
// 会自动从持仓数据里挑出高危点（贴近成本价、有 LLM 叙述、深亏还要卖或补、弹药不足，
// 但最终结论由你自己答的四问决定——工具只负责让你看见。
// ============================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Select, Radio, Tag, Empty, Divider, Typography, Alert } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { usePortfolio } from "@/hooks/usePortfolio";
import { BIAS_QUESTIONS, biasVerdict, biasSignals, SIGNAL_COLOR, SIGNAL_LABEL, type BiasAnswers } from "@/lib/bias-check";
import type { StockData } from "@/lib/types";

const { Text } = Typography;

const LEVEL_COLOR: Record<string, string> = { go: "green", caution: "gold", stop: "red" };

interface AdviceItem {
  stockCode: string;
  stockName?: string;
  action?: string;
  fairValue?: number | null;
  fairValuePremiumPct?: number | null;
  currentPrice?: number | null;
}

interface Props {
  stockDataMap: Map<string, StockData>;
}

export default function BiasChecklist({ stockDataMap }: Props) {
  const { positions, metrics } = usePortfolio(stockDataMap);
  const [code, setCode] = useState<string | null>(null);
  const [advice, setAdvice] = useState<AdviceItem[]>([]);
  const [narrativeCodes, setNarrativeCodes] = useState<Set<string>>(new Set());
  const [cash, setCash] = useState<number | null>(null);
  const [cashFloorNeeded, setCashFloorNeeded] = useState<number | null>(null);
  const [answers, setAnswers] = useState<BiasAnswers>({
    valuationNotCost: true,
    numbersNotStory: true,
    wouldActIfFlat: true,
    canStateCounter: true,
  });

  // 默认选浮亏最深的那只（最容易受损失厌恶影响的）
  useEffect(() => {
    if (code || positions.length === 0) return;
    let worst: { code: string; pct: number } | null = null;
    for (const p of positions) {
      const m = metrics.get(p.id);
      const pct = m?.totalProfitPct ?? 0;
      if (!worst || pct < worst.pct) worst = { code: p.stockCode, pct };
    }
    if (worst) setCode(worst.code);
  }, [positions, metrics, code]);

  const load = useCallback(async () => {
    const [aRes, cRes] = await Promise.allSettled([
      fetch("/api/portfolio-advice", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/cash", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (aRes.status === "fulfilled" && aRes.value?.success) {
      setAdvice(aRes.value?.data?.advice ?? []);
    }
    if (cRes.status === "fulfilled" && cRes.value?.success) {
      setCash(Number(cRes.value.data?.amount ?? 0));
    }
    // 有没有护城河叙述（LLM 生成）——用来提示叙事谬误
    try {
      const r = await fetch("/api/moat", { cache: "no-store" }).then((x) => x.json());
      if (r?.success && r.data) {
        const s = new Set<string>();
        for (const [k, v] of Object.entries(r.data as Record<string, { narrative?: unknown }>)) {
          if (v?.narrative) s.add(k);
        }
        setNarrativeCodes(s);
        // 现金不足门槛（用于弹药提示）：从 mock 中不算，这里留 0 表示不启用强判定
        setCashFloorNeeded(0);
      }
    } catch {
      /* 忽略：没有护城河缓存也能用 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pos = positions.find((p) => p.stockCode === code);
  const metric = pos ? metrics.get(pos.id) : undefined;
  const adv = advice.find((a) => a.stockCode === code);

  const signals = useMemo(() => biasSignals({
    price: adv?.currentPrice ?? (pos ? metric?.currentPrice ?? null : null),
    cost: pos?.buyPrice ?? null,
    profitPct: metric?.totalProfitPct ?? null,
    fairValue: adv?.fairValue ?? null,
    hasNarrative: code ? narrativeCodes.has(code) : false,
    action: adv?.action ?? null,
    cash,
    cashFloorNeeded,
  }), [adv, pos, metric, code, narrativeCodes, cash, cashFloorNeeded]);

  const verdict = useMemo(() => biasVerdict(answers), [answers]);

  if (positions.length === 0) return null;

  const options = positions.map((p) => ({
    value: p.stockCode,
    label: `${p.stockName || p.stockCode}${metric ? `（${metrics.get(p.id)?.totalProfitPct != null ? `${metrics.get(p.id)!.totalProfitPct.toFixed(1)}%` : ""}）` : ""}`,
  }));

  return (
    <Card
      size="small"
      title={<span><SafetyCertificateOutlined /> 下单前偏误自检</span>}
      extra={<Tag color={LEVEL_COLOR[verdict.level]}>{verdict.label}</Tag>}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Text type="secondary">这次要动手的标的</Text>
        <Select
          size="small"
          style={{ minWidth: 220 }}
          value={code ?? undefined}
          onChange={setCode}
          options={options}
          showSearch
          optionFilterProp="label"
        />
        {adv?.action && <Text style={{ fontSize: 12 }}>当前建议：{adv.action}</Text>}
      </div>

      {/* 自动信号 */}
      {signals.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          {signals.map((s, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <Tag color={SIGNAL_COLOR[s.kind]}>{SIGNAL_LABEL[s.kind]}</Tag>
              <Text style={{ fontSize: 12 }}>{s.text}</Text>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 10, fontSize: 12, color: "#888" }}>
          没有自动检出的高危点。仍然建议手动把下面四问过一遍——偏误不需要明显的理由就会发生。
        </div>
      )}

      <Divider style={{ margin: "8px 0" }} />

      {/* 四问 */}
      {BIAS_QUESTIONS.map((q, i) => (
        <div key={q.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <Text style={{ fontSize: 13, minWidth: 300 }}>
            {i + 1}. {q.question}
            <span style={{ color: "#aaa", fontSize: 11, marginLeft: 6 }}>{q.book}</span>
          </Text>
          <Radio.Group
            size="small"
            value={answers[q.key]}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value as boolean }))}
          >
            <Radio.Button value={true}>是</Radio.Button>
            <Radio.Button value={false}>否</Radio.Button>
          </Radio.Group>
        </div>
      ))}

      <Alert
        style={{ marginTop: 10 }}
        type={verdict.level === "go" ? "success" : verdict.level === "caution" ? "warning" : "error"}
        showIcon
        message={verdict.advice}
        description={
          verdict.triggered.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {verdict.triggered.map((t, i) => (
                <li key={i}>{t.risk}（{t.book}）</li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: 12 }}>记录下你的理由：哪几个数字让你做出这个决定。</span>
          )
        }
      />

      <div style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
        依据《思考，快与慢》：知道有偏误并不能消除偏误，所以要把它变成每次下单前必须过一遍的清单。
      </div>
    </Card>
  );
}
