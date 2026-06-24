// ============================================================
// PortfolioPanel.tsx — 持仓成本管理面板
// ============================================================

"use client";

import { useState, useMemo } from "react";
import {
  Card, Table, Button, Input, InputNumber, Modal, Form, Statistic,
  Flex, Tag, Typography, Empty, Space, Popconfirm, Tooltip, Row, Col,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, DollarOutlined,
  FundOutlined, RiseOutlined, FallOutlined,
  GiftOutlined, WalletOutlined, PieChartOutlined,
} from "@ant-design/icons";
import DonutChart from "./DonutChart";
import type { Position, PositionMetrics, StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioSync } from "@/hooks/usePortfolioSync";

const { Text, Title } = Typography;

// ─── 格式化 ─────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--";

const fmtPct = (v: number | null | undefined): string =>
  v != null ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";

const fmtMoney = (v: number | null | undefined): string =>
  v != null ? "¥" + fmt(v, 2) : "--";

// ─── 组件 ──────────────────────────────────────────────────

interface PortfolioPanelProps {
  stockDataMap: Map<string, StockData>;
}

export default function PortfolioPanel({ stockDataMap }: PortfolioPanelProps) {
  const {
    positions, metrics, summary,
    addPosition, removePosition, addDividend, removeDividend,
  } = usePortfolio(stockDataMap);

  usePortfolioSync(positions);

  // ── 添加持仓弹窗 ──────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();

  const handleAdd = () => {
    addForm.validateFields().then((values) => {
      const code = (values.stockCode as string).replace(/\D/g, "");
      const existing = stockDataMap.get(code);
      addPosition({
        stockCode: code,
        stockName: (existing?.quote.name ?? values.stockName) || code,
        shares: values.shares,
        buyPrice: values.buyPrice,
        totalCost: values.totalCost ?? values.shares * values.buyPrice,
        buyDate: values.buyDate || new Date().toISOString().slice(0, 10),
      });
      addForm.resetFields();
      setAddOpen(false);
    }).catch(() => {});
  };

  // ── 记录分红弹窗 ──────────────────────────────────
  const [divOpen, setDivOpen] = useState(false);
  const [divPositionId, setDivPositionId] = useState<string | null>(null);
  const [divForm] = Form.useForm();

  const handleAddDividend = () => {
    divForm.validateFields().then((values) => {
      if (divPositionId) {
        addDividend(divPositionId, {
          date: values.date || new Date().toISOString().slice(0, 10),
          perShare: values.perShare,
          total: values.total ?? values.perShare * (
            positions.find((p) => p.id === divPositionId)?.shares ?? 0
          ),
        });
        divForm.resetFields();
        setDivOpen(false);
        setDivPositionId(null);
      }
    }).catch(() => {});
  };

  // ── 列定义 ──────────────────────────────────────────

  const columns = [
    {
      title: "名称", key: "name", width: 90,
      render: (_: any, r: Position) => {
        const sd = stockDataMap.get(r.stockCode);
        const color = sd?.quote.changePercent
          ? (sd.quote.changePercent > 0 ? "var(--red)" : sd.quote.changePercent < 0 ? "var(--green)" : "var(--text-tertiary)")
          : "var(--text-tertiary)";
        return (
          <div>
            <div style={{ fontWeight: 500, color: "var(--text-primary)", fontSize: 13 }}>{r.stockName}</div>
            <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color }}>
              ¥{fmt(sd?.quote.currentPrice ?? r.buyPrice)}
              {sd?.quote.changePercent != null && (
                <span style={{ marginLeft: 4 }}>
                  {sd.quote.changePercent > 0 ? "+" : ""}{sd.quote.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: "持股", key: "shares", width: 70,
      render: (_: any, r: Position) => (
        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}>
          {r.shares.toLocaleString()}
        </span>
      ),
    },
    {
      title: "成本均价", key: "avgCost", width: 80,
      sorter: (a: Position, b: Position) => a.buyPrice - b.buyPrice,
      render: (_: any, r: Position) => (
        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}>
          ¥{fmt(r.buyPrice)}
        </span>
      ),
    },
    {
      title: "总投入", key: "totalCost", width: 80,
      sorter: (a: Position, b: Position) => a.totalCost - b.totalCost,
      render: (_: any, r: Position) => (
        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}>
          ¥{fmt(r.totalCost)}
        </span>
      ),
    },
    {
      title: "累计分红", key: "totalDiv", width: 80,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id)?.totalDividends ?? 0;
        const mb = metrics.get(b.id)?.totalDividends ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => (
        <Tooltip title={
          r.dividends.length > 0
            ? r.dividends.map((d) => `${d.date} ¥${d.perShare}/股 × ${fmt(d.total)}`).join("\n")
            : "暂无分红记录"
        }>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, color: "var(--green)", cursor: "help" }}>
            ¥{fmt(metrics.get(r.id)?.totalDividends)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: "真实成本", key: "realCost", width: 80,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id)?.realCost ?? 0;
        const mb = metrics.get(b.id)?.realCost ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const rc = metrics.get(r.id)?.realCost;
        const col = rc != null && rc < r.totalCost ? "var(--green)" : undefined;
        return (
          <Tooltip title="总投入 - 累计分红，越拿越便宜" color="#27272a">
            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, color: col, cursor: "help" }}>
              ¥{fmt(rc)}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "成本股息率", key: "costYield", width: 85,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id)?.costYield ?? 0;
        const mb = metrics.get(b.id)?.costYield ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const y = metrics.get(r.id)?.costYield;
        const col = y != null && y > 8 ? "var(--green)" : y != null && y > 5 ? "var(--blue)" : undefined;
        return (
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, fontWeight: y != null && y > 8 ? 700 : 400, color: col }}>
            {y != null ? y.toFixed(2) + "%" : "--"}
          </span>
        );
      },
    },
    {
      title: "盈亏", key: "profit", width: 80,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id)?.totalProfit ?? 0;
        const mb = metrics.get(b.id)?.totalProfit ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const m = metrics.get(r.id);
        if (!m) return "--";
        const col = m.totalProfit > 0 ? "var(--red)" : m.totalProfit < 0 ? "var(--green)" : "var(--text-tertiary)";
        return (
          <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, textAlign: "right" }}>
            <div style={{ color: col, fontWeight: Math.abs(m.totalProfitPct) > 20 ? 700 : 400 }}>
              {m.totalProfit > 0 ? "+" : ""}{fmt(m.totalProfit)}
            </div>
            <div style={{ color: col, fontSize: 11 }}>{fmtPct(m.totalProfitPct)}</div>
          </div>
        );
      },
    },
    {
      title: "操作", key: "actions", width: 90,
      render: (_: any, r: Position) => (
        <Space size="small">
          <Button
            type="link" size="small"
            icon={<GiftOutlined />}
            onClick={() => { setDivPositionId(r.id); setDivOpen(true); }}
          />
          <Popconfirm
            title="删除此持仓？"
            description="分红记录也会一起删除"
            onConfirm={() => removePosition(r.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      title={
        <Flex align="center" gap={8}>
          <WalletOutlined />
          <span style={{ fontWeight: 600 }}>持仓管理</span>
        </Flex>
      }
      extra={
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加持仓
        </Button>
      }
    >
      {/* ═══ 汇总统计 + 持仓分布环形图 ═══ */}
      <Flex gap={16} style={{ marginBottom: 16 }} align="start">
        {/* 左侧：SVG 环形图 + 图例 */}
        {positions.length > 0 && (
          <Flex gap={12} align="center" style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "var(--bg-card)",
            boxShadow: "var(--card-shadow)",
            flexShrink: 0,
          }}>
            <DonutChart
              positions={positions}
              getMarketValue={(p) => {
                const sd = stockDataMap.get(p.stockCode);
                const price = sd?.quote.currentPrice ?? p.buyPrice;
                return p.shares * price;
              }}
              getLabel={(p) => p.stockName}
              size={120}
            />
            <div style={{ width: 140 }}>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>持仓分布</div>
              {positions.slice(0, 6).map((p, i) => {
                const mv = (() => {
                  const sd = stockDataMap.get(p.stockCode);
                  return (sd?.quote.currentPrice ?? p.buyPrice) * p.shares;
                })();
                const total = positions.reduce((s, pp) => {
                  const sd2 = stockDataMap.get(pp.stockCode);
                  return s + (sd2?.quote.currentPrice ?? pp.buyPrice) * pp.shares;
                }, 0);
                const pct = total > 0 ? (mv / total) * 100 : 0;
                const colors = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#06b6d4"];
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, marginBottom: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {p.stockName}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-tertiary)" }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
              {positions.length > 6 && (
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                  +{positions.length - 6} 只
                </div>
              )}
            </div>
          </Flex>
        )}

        {/* 右侧：统计数据 */}
        <Flex gap={16} wrap="wrap" style={{ flex: 1 }}>
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>总投入</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>
              ¥{fmt(summary.totalInvested)}
            </div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>当前市值</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>
              ¥{fmt(summary.totalMarketValue)}
            </div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>累计分红</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--green)" }}>
              ¥{fmt(summary.totalDividends)}
            </div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>总盈亏</div>
            <div style={{
              fontSize: 18, fontWeight: 600,
              color: summary.totalProfit > 0 ? "#ef4444" : summary.totalProfit < 0 ? "#22c55e" : "var(--text-primary)",
            }}>
              {summary.totalProfit >= 0 ? "+" : ""}¥{fmt(Math.abs(summary.totalProfit))}
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>
                ({summary.totalProfit >= 0 ? "+" : ""}{summary.totalProfitPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </Flex>
      </Flex>

      {/* ═══ 持仓列表 ═══ */}
      {positions.length === 0 ? (
        <Empty
          description="暂无持仓记录"
          style={{ padding: 24 }}
        >
          <Button type="primary" size="small" onClick={() => setAddOpen(true)}>
            添加第一笔持仓
          </Button>
        </Empty>
      ) : (
        <Table
          dataSource={positions}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          style={{ fontSize: 12 }}
        />
      )}

      {/* ═══ 添加持仓弹窗 ═══ */}
      <Modal
        title="添加持仓"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAdd}
        okText="添加"
        cancelText="取消"
        width={400}
      >
        <Form form={addForm} layout="vertical" size="small">
          <Form.Item name="stockCode" label="股票代码" rules={[{ required: true, message: "请输入6位代码" }]}>
            <Input placeholder="600519" maxLength={6} />
          </Form.Item>
          <Form.Item name="stockName" label="股票名称（自动填充，可选）">
            <Input placeholder="自动从行情获取" />
          </Form.Item>
          <Form.Item name="shares" label="持有股数" rules={[{ required: true, message: "请输入股数" }]}>
            <InputNumber style={{ width: "100%" }} min={1} placeholder="100" />
          </Form.Item>
          <Form.Item name="buyPrice" label="买入均价（元/股）" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0.01} step={0.01} placeholder="35.50" />
          </Form.Item>
          <Form.Item name="totalCost" label="总投入（元，含手续费，可选）">
            <InputNumber style={{ width: "100%" }} min={0} step={0.01} placeholder="自动计算" />
          </Form.Item>
          <Form.Item name="buyDate" label="买入日期">
            <input type="date" style={{ width: "100%", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-color)" }}
              defaultValue={new Date().toISOString().slice(0, 10)} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ═══ 记录分红弹窗 ═══ */}
      <Modal
        title="记录分红"
        open={divOpen}
        onCancel={() => { setDivOpen(false); setDivPositionId(null); }}
        onOk={handleAddDividend}
        okText="记录"
        cancelText="取消"
        width={360}
      >
        <Form form={divForm} layout="vertical" size="small">
          <Form.Item name="perShare" label="每股分红（元）" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0.01} step={0.01} placeholder="2.20" />
          </Form.Item>
          <Form.Item name="total" label="实际到账（元，可选）">
            <InputNumber style={{ width: "100%" }} min={0} step={0.01} placeholder="自动计算" />
          </Form.Item>
          <Form.Item name="date" label="到账日期">
            <input type="date" style={{ width: "100%", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-color)" }}
              defaultValue={new Date().toISOString().slice(0, 10)} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
