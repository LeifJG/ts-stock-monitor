// ============================================================
// PortfolioPanel.tsx — 持仓成本管理面板
// ============================================================

"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Card, Table, Button, Input, InputNumber, Modal, Form, Statistic,
  Flex, Tag, Typography, Empty, Space, Popconfirm, Tooltip, Row, Col,
} from "antd";
import {
  PlusOutlined, MinusOutlined, DeleteOutlined, DollarOutlined,
  FundOutlined, RiseOutlined, FallOutlined,
  GiftOutlined, WalletOutlined, PieChartOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import DonutChart from "./DonutChart";
import TradeAdviceCard from "./TradeAdvice";
import PortfolioSyncModal from "./PortfolioSyncModal";
import { calcMarketValue } from "@/lib/stockUtils";
import type { Position, StockData } from "@/lib/types";
import type { ValuationData } from "@/app/api/valuation/route";
import { computeTradeAdvice, type TradeAdvice } from "@/lib/trade-advice";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioSync } from "@/hooks/usePortfolioSync";
import { message } from "antd";

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
  // usePortfolio 内部自动合并持仓实时行情（含 watchlist 外的港股，共享缓存）
  const {
    positions, metrics, summary,
    stockDataMap: combinedStockDataMap,
    addPosition, removePosition, updatePosition, addDividend, removeDividend,
  } = usePortfolio(stockDataMap);

  usePortfolioSync(positions);

  // ── 同步弹窗 ──────────────────────────────────
  const [syncOpen, setSyncOpen] = useState(false);

  // ── 添加持仓弹窗 ──────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  // 交易建议（输入代码后动态查询）
  const [advice, setAdvice] = useState<TradeAdvice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceCode, setAdviceCode] = useState<string>("");

  // 监听股票代码输入 → 查询行情+估值 → 生成建议
  const adviceTimer = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);
  const handleCodeChange = (value: string) => {
    let code = (value ?? "").replace(/\D/g, "").slice(0, 6);
    if (code.length >= 1 && code.length < 5) code = code.padStart(5, "0"); // 港股短码补零：700/0700→00700
    if (adviceTimer.current) clearTimeout(adviceTimer.current);
    if (code.length !== 5 && code.length !== 6) {
      setAdvice(null);
      setAdviceCode("");
      return;
    }
    adviceTimer.current = setTimeout(() => {
      setAdviceLoading(true);
      setAdviceCode(code);
      Promise.all([
        fetch(`/api/stocks?codes=${code}`).then((r) => r.json()),
        fetch(`/api/valuation?codes=${code}`).then((r) => r.json()),
      ])
        .then(([stockJson, valJson]) => {
          const stock = stockJson?.success ? stockJson.data?.[0] : undefined;
          const valuation: ValuationData | undefined = valJson?.success ? valJson.data?.[0] : undefined;
          setAdvice(computeTradeAdvice(stock, valuation));
        })
        .catch(() => setAdvice(null))
        .finally(() => setAdviceLoading(false));
    }, 400);
  };

  const handleAdd = () => {
    addForm.validateFields().then((values) => {
      let code = (values.stockCode as string).replace(/\D/g, "");
      if (code.length >= 1 && code.length < 5) code = code.padStart(5, "0"); // 港股短码补零：700/0700→00700
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
      setAdvice(null);
      setAdviceCode("");
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

  // ── 调仓弹窗（加仓 / 减仓）──────────────────────
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradePosition, setTradePosition] = useState<Position | null>(null);
  const [tradeMode, setTradeMode] = useState<"add" | "reduce">("add");
  const [tradeForm] = Form.useForm();

  // 当前实时价（调仓默认价）
  const tradeCurrentPrice = useMemo(() => {
    if (!tradePosition) return null;
    return combinedStockDataMap.get(tradePosition.stockCode ?? "")?.quote.currentPrice ?? tradePosition.buyPrice ?? null;
  }, [tradePosition, combinedStockDataMap]);

  // 打开调仓弹窗
  const openTrade = (r: Position, mode: "add" | "reduce") => {
    setTradePosition(r);
    setTradeMode(mode);
    setTradeOpen(true);
    // 预填：股数留空，价格默认实时价（下一个 tick 等表单挂载）
    setTimeout(() => {
      tradeForm.setFieldsValue({ price: tradeCurrentPrice ?? undefined, shares: undefined });
    }, 0);
  };

  // 监听表单值变化（触发预览重算）
  const watchShares = Form.useWatch("shares", tradeForm);
  const watchPrice = Form.useWatch("price", tradeForm);

  // 调仓实时预览：新股数 / 新成本均价 / 新总投入
  const tradePreview = useMemo(() => {
    if (!tradePosition) return null;
    const shares = watchShares as number | undefined;
    const price = watchPrice as number | undefined;
    if (!shares || shares <= 0 || !price || price <= 0) return null;
    const oldShares = tradePosition.shares;
    const oldCost = tradePosition.totalCost ?? oldShares * (tradePosition.buyPrice ?? 0);
    if (tradeMode === "add") {
      const newShares = oldShares + shares;
      const newCost = oldCost + shares * price;
      return { newShares, newAvgCost: newCost / newShares, newTotalCost: newCost, delta: shares * price };
    }
    if (shares > oldShares) return null; // 减仓超持股，校验会拦截
    const newShares = oldShares - shares;
    // 加权平均成本法：均价不变，总投入按剩余股数折算，落袋部分转为已实现收益
    const avg = tradePosition.buyPrice ?? oldCost / oldShares;
    return { newShares, newAvgCost: avg, newTotalCost: avg * newShares, delta: shares * price };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradePosition, tradeMode, tradeForm.getFieldValue("shares"), tradeForm.getFieldValue("price")]);

  const handleTrade = () => {
    tradeForm.validateFields().then((values) => {
      if (!tradePosition) return;
      const { shares, price } = values as { shares: number; price: number };
      if (tradeMode === "add") {
        // 加仓：加权平均
        const oldShares = tradePosition.shares;
        const oldCost = tradePosition.totalCost ?? oldShares * (tradePosition.buyPrice ?? 0);
        const newShares = oldShares + shares;
        const newCost = oldCost + shares * price;
        updatePosition(tradePosition.id!, {
          shares: newShares,
          totalCost: newCost,
          buyPrice: newCost / newShares,
          lastAddPrice: price, // 记录本次加仓价，供补仓间距判断
        });
        message.success(`已加仓 ${tradePosition.stockName} +${shares} 股 @¥${price}`);
      } else {
        const newShares = tradePosition.shares - shares;
        if (newShares <= 0) {
          // 清仓：整条删除
          removePosition(tradePosition.id!);
          message.success(`已清仓 ${tradePosition.stockName}（+¥${(shares * price).toFixed(2)} 落袋）`);
        } else {
          // 减仓：均价不变，总投入按剩余股数折算
          const avg = tradePosition.buyPrice ?? 0;
          updatePosition(tradePosition.id!, {
            shares: newShares,
            totalCost: avg * newShares,
          });
          message.success(`已减仓 ${tradePosition.stockName} -${shares} 股 @¥${price}`);
        }
      }
      setTradeOpen(false);
      setTradePosition(null);
      tradeForm.resetFields();
    }).catch(() => {});
  };

  // ── 同步持仓处理 ──────────────────────────────────
  const handleSyncPositions = (data: Array<{ code: string; name?: string; shares: number; cost: number }>) => {
    let added = 0;
    let updated = 0;
    const today = new Date().toISOString().slice(0, 10);
    
    data.forEach(item => {
      const existing = positions.find(p => p.stockCode === item.code);
      if (existing) {
        // 更新已有持仓（ shares/cost 可能变了）
        if (existing.shares !== item.shares || Math.abs((existing.buyPrice ?? 0) - item.cost) > 0.001) {
          // 删除旧的，添加新的
          removePosition(existing.id ?? "");
          addPosition({
            stockCode: item.code,
            stockName: item.name || item.code,
            shares: item.shares,
            buyPrice: item.cost,
            totalCost: item.shares * item.cost,
            buyDate: today,
          });
          updated++;
        }
      } else {
        addPosition({
          stockCode: item.code,
          stockName: item.name || item.code,
          shares: item.shares,
          buyPrice: item.cost,
          totalCost: item.shares * item.cost,
          buyDate: today,
        });
        added++;
      }
    });
    
    const parts: string[] = [];
    if (added > 0) parts.push(`新增 ${added} 条`);
    if (updated > 0) parts.push(`更新 ${updated} 条`);
    if (parts.length === 0) parts.push("无变化");
    message.success(`同步完成：${parts.join("，")}（${data.length} 条数据）`);
    setSyncOpen(false);
  };

  // ── 列定义 ──────────────────────────────────────────

  const columns = [
    {
      title: "名称", key: "name", width: 90,
      render: (_: any, r: Position) => {
        const sd = combinedStockDataMap.get(r.stockCode || "");
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
      sorter: (a: Position, b: Position) => (a.buyPrice ?? 0) - (b.buyPrice ?? 0),
      render: (_: any, r: Position) => (
        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}>
          ¥{fmt(r.buyPrice)}
        </span>
      ),
    },
    {
      title: "总投入", key: "totalCost", width: 80,
      sorter: (a: Position, b: Position) => (a.totalCost ?? 0) - (b.totalCost ?? 0),
      render: (_: any, r: Position) => (
        <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}>
          ¥{fmt(r.totalCost)}
        </span>
      ),
    },
    {
      title: "累计分红", key: "totalDiv", width: 80,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id ?? "")?.totalDividends ?? 0;
        const mb = metrics.get(b.id ?? "")?.totalDividends ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => (
        <Tooltip title={
          (r.dividends || []).length > 0
            ? (r.dividends || []).map((d) => `${d.date} ¥${d.perShare}/股 × ${fmt(d.total)}`).join("\n")
            : "暂无分红记录"
        }>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, color: "var(--green)", cursor: "help" }}>
            ¥{fmt(metrics.get(r.id ?? "")?.totalDividends)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: "真实成本", key: "realCost", width: 80,
      sorter: (a: Position, b: Position) => {
        const ma = metrics.get(a.id ?? "")?.realCost ?? 0;
        const mb = metrics.get(b.id ?? "")?.realCost ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const rc = metrics.get(r.id ?? "")?.realCost;
        const col = rc != null && rc < (r.totalCost ?? 0) ? "var(--green)" : undefined;
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
        const ma = metrics.get(a.id ?? "")?.costYield ?? 0;
        const mb = metrics.get(b.id ?? "")?.costYield ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const y = metrics.get(r.id ?? "")?.costYield;
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
        const ma = metrics.get(a.id ?? "")?.totalProfit ?? 0;
        const mb = metrics.get(b.id ?? "")?.totalProfit ?? 0;
        return ma - mb;
      },
      render: (_: any, r: Position) => {
        const m = metrics.get(r.id ?? "");
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
      title: "操作", key: "actions", width: 150,
      render: (_: any, r: Position) => (
        <Space size={0}>
          <Tooltip title="加仓">
            <Button
              type="link" size="small"
              icon={<PlusOutlined />}
              onClick={() => openTrade(r, "add")}
            />
          </Tooltip>
          <Tooltip title="减仓 / 清仓">
            <Button
              type="link" size="small"
              icon={<MinusOutlined />}
              onClick={() => openTrade(r, "reduce")}
            />
          </Tooltip>
          <Tooltip title="记录分红">
            <Button
              type="link" size="small"
              icon={<GiftOutlined />}
              onClick={() => { setDivPositionId(r.id ?? null); setDivOpen(true); }}
            />
          </Tooltip>
          <Popconfirm
            title="删除此持仓？"
            description="分红记录也会一起删除"
            onConfirm={() => removePosition(r.id ?? "")}
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
        <Space>
          <Button size="small" icon={<SyncOutlined />} onClick={() => setSyncOpen(true)} style={{ borderColor: "var(--blue)", color: "var(--blue)" }}>
            同步持仓
          </Button>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            添加持仓
          </Button>
        </Space>
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
              getMarketValue={(p) =>
                calcMarketValue(
                  p.stockCode || "",
                  p.shares,
                  combinedStockDataMap.get(p.stockCode || "")?.quote.currentPrice ?? p.buyPrice ?? 0
                )
              }
              getLabel={(p) => p.stockName || p.stockCode || ""}
              size={120}
            />
            <div style={{ width: 140 }}>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>持仓分布</div>
              {positions.slice(0, 6).map((p, i) => {
                const mv = (() => {
                  return calcMarketValue(
                    p.stockCode || "",
                    p.shares,
                    combinedStockDataMap.get(p.stockCode || "")?.quote.currentPrice ?? p.buyPrice ?? 0
                  );
                })();
                const total = positions.reduce((s, pp) => {
                  return s + calcMarketValue(
                    pp.stockCode || "",
                    pp.shares,
                    combinedStockDataMap.get(pp.stockCode || "")?.quote.currentPrice ?? pp.buyPrice ?? 0
                  );
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
          dataSource={positions.filter(p => p.shares > 0)}
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
        onCancel={() => { setAddOpen(false); setAdvice(null); setAdviceCode(""); }}
        onOk={handleAdd}
        okText="添加"
        cancelText="取消"
        width={460}
      >
        <Form form={addForm} layout="vertical" size="small">
          <Form.Item
            name="stockCode"
            label="股票代码"
            rules={[
              { required: true, message: "请输入代码" },
              { pattern: /^\d{1,6}$/, message: "A股6位 / 港股5位(短码自动补0)" },
            ]}
          >
            <Input placeholder="600519 / 01810 / 700" maxLength={6} onChange={(e) => handleCodeChange(e.target.value)} />
          </Form.Item>
          <Form.Item name="stockName" label="股票名称（自动填充，可选）">
            <Input placeholder="自动从行情获取" />
          </Form.Item>

          {/* ═══ 交易建议卡片 ═══ */}
          {(adviceCode || adviceLoading) && (
            <div style={{ marginBottom: 16 }}>
              <TradeAdviceCard advice={advice} loading={adviceLoading} />
            </div>
          )}

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

      {/* ═══ 调仓弹窗（加仓 / 减仓）═══ */}
      <Modal
        title={
          tradePosition && (
            <Space size={8}>
              <span>{tradeMode === "add" ? "加仓" : "减仓 / 清仓"}</span>
              <span style={{ fontWeight: 500, color: "var(--text-tertiary)", fontSize: 13 }}>
                {tradePosition.stockName} · 现持 {tradePosition.shares.toLocaleString()} 股 · 均价 ¥{fmt(tradePosition.buyPrice)}
              </span>
            </Space>
          )
        }
        open={tradeOpen}
        onCancel={() => { setTradeOpen(false); setTradePosition(null); tradeForm.resetFields(); }}
        onOk={handleTrade}
        okText={tradeMode === "add" ? "确认加仓" : "确认减仓"}
        cancelText="取消"
        width={400}
      >
        <Form form={tradeForm} layout="vertical" size="small">
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item
                name="shares"
                label="股数"
                rules={[
                  { required: true, message: "请输入股数" },
                  {
                    validator: (_, v) =>
                      tradeMode === "reduce" && tradePosition && v > tradePosition.shares
                        ? Promise.reject(new Error(`最多可减 ${tradePosition.shares} 股`))
                        : Promise.resolve(),
                  },
                ]}
              >
                <InputNumber
                  style={{ width: "100%" }}
                  min={1}
                  step={100}
                  precision={0}
                  placeholder="如 500"
                  autoFocus
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="price"
                label="成交价（元）"
                rules={[{ required: true, message: "请输入价格" }]}
              >
                <InputNumber style={{ width: "100%" }} min={0.01} step={0.01} placeholder="默认实时价" />
              </Form.Item>
            </Col>
          </Row>

          {/* 快捷比例（减仓用） */}
          {tradeMode === "reduce" && tradePosition && (
            <Space size={4} style={{ marginBottom: 8 }}>
              {[0.25, 0.5, 0.75, 1].map((r) => (
                <Button
                  key={r}
                  size="small"
                  onClick={() => {
                    const s = Math.round(tradePosition.shares * r / 100) * 100;
                    tradeForm.setFieldsValue({
                      shares: r === 1 ? tradePosition.shares : Math.max(100, s),
                      price: tradeForm.getFieldValue("price") || tradeCurrentPrice,
                    });
                  }}
                >
                  {r === 1 ? "全部" : `${r * 100}%`}
                </Button>
              ))}
            </Space>
          )}

          {/* 实时预览 */}
          {tradePreview && (
            <div style={{
              padding: "8px 12px", borderRadius: 6, fontSize: 12,
              background: "var(--bg-card)", border: "1px solid var(--border-color)",
            }}>
              <div style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>调仓后预览</div>
              <div style={{ display: "flex", gap: 16 }}>
                <span>持股 <b style={{ color: "var(--text-primary)" }}>{tradePreview.newShares.toLocaleString()}</b></span>
                <span>均价 <b style={{ color: "var(--text-primary)" }}>¥{fmt(tradePreview.newAvgCost)}</b></span>
                <span>总投入 <b style={{ color: "var(--text-primary)" }}>¥{fmt(tradePreview.newTotalCost)}</b></span>
              </div>
              <div style={{ color: tradeMode === "add" ? "var(--red)" : "var(--green)", marginTop: 2 }}>
                {tradeMode === "add" ? "投入" : "落袋"} ¥{fmt(tradePreview.delta)}
              </div>
            </div>
          )}
        </Form>
      </Modal>

      {/* ═══ 同步持仓弹窗 ═══ */}
      <PortfolioSyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onSync={handleSyncPositions}
      />
    </Card>
  );
}
