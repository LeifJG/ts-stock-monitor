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
  GiftOutlined, WalletOutlined,
} from "@ant-design/icons";
import type { Position, PositionMetrics, StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";

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
          ? (sd.quote.changePercent > 0 ? "#ef4444" : sd.quote.changePercent < 0 ? "#22c55e" : "#9ca3af")
          : "#9ca3af";
        return (
          <div>
            <div style={{ fontWeight: 500, color: "#111827", fontSize: 13 }}>{r.stockName}</div>
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
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, color: "#16a34a", cursor: "help" }}>
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
        const col = rc != null && rc < r.totalCost ? "#16a34a" : undefined;
        return (
          <Tooltip title="总投入 - 累计分红，越拿越便宜" color="#1f2937">
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
        const col = y != null && y > 8 ? "#16a34a" : y != null && y > 5 ? "#2563eb" : undefined;
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
        const col = m.totalProfit > 0 ? "#ef4444" : m.totalProfit < 0 ? "#22c55e" : "#9ca3af";
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
      {/* ═══ 汇总统计 ═══ */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Statistic title="总投入" value={summary.totalInvested} prefix="¥" precision={2}
            valueStyle={{ fontSize: 18, fontWeight: 600 }} />
        </Col>
        <Col span={6}>
          <Statistic title="当前市值" value={summary.totalMarketValue} prefix="¥" precision={2}
            valueStyle={{ fontSize: 18, fontWeight: 600 }} />
        </Col>
        <Col span={6}>
          <Statistic title="累计分红" value={summary.totalDividends} prefix="¥" precision={2}
            valueStyle={{ fontSize: 18, color: "#16a34a", fontWeight: 600 }} />
        </Col>
        <Col span={6}>
          <Statistic
            title="总盈亏"
            value={summary.totalProfit}
            prefix={summary.totalProfit >= 0 ? "+" : ""}
            suffix={summary.totalProfitPct != 0 ? `(${fmtPct(summary.totalProfitPct)})` : ""}
            precision={2}
            valueStyle={{
              fontSize: 18, fontWeight: 600,
              color: summary.totalProfit > 0 ? "#ef4444" : summary.totalProfit < 0 ? "#22c55e" : "#9ca3af",
            }}
          />
        </Col>
      </Row>

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
            <input type="date" style={{ width: "100%", padding: "4px 8px", borderRadius: 6, border: "1px solid #d9d9d9" }}
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
            <input type="date" style={{ width: "100%", padding: "4px 8px", borderRadius: 6, border: "1px solid #d9d9d9" }}
              defaultValue={new Date().toISOString().slice(0, 10)} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
