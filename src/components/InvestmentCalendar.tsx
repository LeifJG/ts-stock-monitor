"use client";

// ============================================================
// src/components/InvestmentCalendar.tsx — 定投日历
// ============================================================
// 每个计划显示：今天该不该买、买多少、依据是什么。
//
// 三个状态的含义要分清（界面上用不同颜色 + 文案区分）：
//   buy  → 今天是定投日且所有条件通过 → 显示建议金额
//   skip → 今天是定投日但被拦下（溢价超标 / 数据缺失）→ 显示「今天不买」+ 拦下原因
//   wait → 今天不是定投日 → 显示下次定投日与当前估值位置
//
// 为什么「skip」要单独一档而不是并入「wait」：
// 到日子没买是主动决策，不是没到日子，混在一起会让用户以为自己漏投了。

import { useCallback, useEffect, useState } from "react";
import { Alert, Card, Col, Empty, Flex, Row, Spin, Tag, Tooltip, Typography } from "antd";
import { CalendarOutlined, ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface PlanResult {
  planId: string;
  name: string;
  mode: "onsite" | "otc";
  target: string | null;
  proxyIndex: string | null;
  isDueToday: boolean;
  frequency: string;
  action: "buy" | "skip" | "wait";
  headline: string;
  amount: number;
  baseAmount: number;
  multiplier: number;
  indexClose: number | null;
  ma: number | null;
  deviationPct: number | null;
  premiumPct: number | null;
  premiumMax: number;
  monthDropPct: number | null;
  reasons: string[];
}

const ACTION_STYLE: Record<string, { color: string; bg: string; text: string }> = {
  buy: { color: "#16a34a", bg: "#f0fdf4", text: "今天买入" },
  skip: { color: "#dc2626", bg: "#fef2f2", text: "今天不买" },
  wait: { color: "#6b7280", bg: "#f9fafb", text: "非定投日" },
};

export default function InvestmentCalendar() {
  const [plans, setPlans] = useState<PlanResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/investment-plans", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
      setPlans(json.plans || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !plans) {
    return (
      <Flex justify="center" align="center" style={{ padding: 40 }}>
        <Spin tip="正在取指数日线与溢价率…" />
      </Flex>
    );
  }

  if (error) {
    return <Alert type="error" showIcon message="定投计划加载失败" description={error} />;
  }

  if (!plans || plans.length === 0) {
    return (
      <Empty
        description={
          <span>
            还没有定投计划。
            <br />
            编辑 <code>data/investment_plans.json</code> 添加，字段说明在文件顶部的 _说明 里。
          </span>
        }
      />
    );
  }

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 15 }}>
          <CalendarOutlined /> 定投日历
        </Text>
        <Tooltip title="重新取数（指数日线有 12 小时缓存，溢价率实时）">
          <ReloadOutlined onClick={load} spin={loading} style={{ cursor: "pointer" }} />
        </Tooltip>
      </Flex>

      <Row gutter={[12, 12]}>
        {plans.map((p) => {
          const style = ACTION_STYLE[p.action] ?? ACTION_STYLE.wait;
          return (
            <Col xs={24} lg={12} key={p.planId}>
              <Card
                size="small"
                style={{ borderLeft: `3px solid ${style.color}`, background: style.bg }}
                title={
                  <Flex align="center" gap={8} wrap="wrap">
                    <Text strong style={{ fontSize: 13 }}>{p.name}</Text>
                    <Tag color={p.mode === "onsite" ? "blue" : "purple"} style={{ fontSize: 10 }}>
                      {p.mode === "onsite" ? "场内" : "场外"}
                    </Tag>
                    {p.target && <Text type="secondary" style={{ fontSize: 11 }}>{p.target}</Text>}
                  </Flex>
                }
                extra={<Tag color={style.color} style={{ fontSize: 11 }}>{style.text}</Tag>}
              >
                {/* 主结论 */}
                <div style={{ marginBottom: 8 }}>
                  {p.action === "buy" ? (
                    <Text strong style={{ fontSize: 20, color: "#16a34a" }}>
                      ¥{p.amount.toLocaleString()}
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                        （{p.multiplier} 份 × ¥{p.baseAmount.toLocaleString()}）
                      </Text>
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 13, color: style.color, fontWeight: 600 }}>
                      {p.headline}
                    </Text>
                  )}
                </div>

                {/* 三个核心指标 */}
                <Flex gap={8} wrap="wrap" style={{ marginBottom: 8 }}>
                  <Tag style={{ fontSize: 11 }}>
                    偏离均线{" "}
                    <b style={{ color: (p.deviationPct ?? 0) < 0 ? "#16a34a" : "#dc2626" }}>
                      {p.deviationPct != null ? `${p.deviationPct > 0 ? "+" : ""}${p.deviationPct.toFixed(1)}%` : "—"}
                    </b>
                  </Tag>
                  {p.mode === "onsite" && (
                    <Tag
                      style={{ fontSize: 11 }}
                      color={p.premiumPct != null && p.premiumPct > p.premiumMax ? "red" : "default"}
                    >
                      溢价率{" "}
                      <b>{p.premiumPct != null ? `${p.premiumPct > 0 ? "+" : ""}${p.premiumPct.toFixed(2)}%` : "—"}</b>
                      <Text type="secondary" style={{ fontSize: 10 }}> / 上限 {p.premiumMax}%</Text>
                    </Tag>
                  )}
                  {p.monthDropPct != null && (
                    <Tag style={{ fontSize: 11 }}>
                      近30日 <b>{p.monthDropPct > 0 ? "+" : ""}{p.monthDropPct.toFixed(1)}%</b>
                    </Tag>
                  )}
                  <Tag style={{ fontSize: 11 }}>{p.frequency}</Tag>
                </Flex>

                {/* 判断依据 */}
                <div>
                  {p.reasons.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.7 }}>
                      · {r}
                    </div>
                  ))}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        message="溢价是场内的确定性成本"
        description={
          <span style={{ fontSize: 12 }}>
            场内 ETF 溢价 = 市价 ÷ 单位净值 − 1。溢价 16% 买入，等于立刻付出 16% 的成本；
            溢价消失时净值不变、价格回落，那部分就是实亏。场外按净值申购没有溢价，
            但要盯申购限额与暂停申购公告。
          </span>
        }
      />
    </div>
  );
}
