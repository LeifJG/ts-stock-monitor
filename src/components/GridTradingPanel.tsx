// ============================================================
// GridTradingPanel.tsx — N. 网格交易助手
// ============================================================
// 支持 4 种网格策略 + 一键告警 + 可视化价格轴 + 参数调节

"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Card, Flex, Typography, Tag, Button, Tooltip, Modal,
  InputNumber, Form, Empty, Collapse, Divider, Row, Col,
  Statistic, Radio, Select,
} from "antd";
import {
  RiseOutlined, FallOutlined, SettingOutlined,
  BellOutlined, LineChartOutlined, InfoCircleOutlined,
  SafetyOutlined, DollarOutlined, ShoppingCartOutlined,
} from "@ant-design/icons";
import type {
  StockData, GridPlan, GridLevelConfig, GridSettings,
  GridStrategy, AlertRule, StockCode,
} from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useAlerts } from "@/hooks/useAlerts";
import {
  computeAllGridPlans, computeGridPlan,
  generateGridAlerts, estimateVolatility, suggestGridStep,
  STRATEGY_LABELS, STRATEGY_DESCRIPTIONS,
} from "@/lib/grid-engine";

const { Text, Title } = Typography;

// ─── 格式化 ─────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--";

const fmtPct = (v: number | null | undefined): string =>
  v != null ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";

const fmtShares = (v: number): string =>
  v >= 10000 ? (v / 10000).toFixed(1) + "万" : v.toLocaleString();

// ─── 颜色体系 ────────────────────────────────────────────────

const BUY_COLOR = "#22c55e";
const BUY_BG = "#f0fdf4";
const SELL_COLOR = "#ef4444";
const SELL_BG = "#fef2f2";
const CURRENT_COLOR = "#3b82f6";

// ─── 组件属性 ───────────────────────────────────────────────

interface GridTradingPanelProps {
  stockDataMap: Map<string, StockData>;
}

// ─── 策略图标 ────────────────────────────────────────────────

const STRATEGY_ICONS: Record<GridStrategy, React.ReactNode> = {
  full: <LineChartOutlined style={{ color: "#8b5cf6" }} />,
  base: <SafetyOutlined style={{ color: "#2563eb" }} />,
  cash: <DollarOutlined style={{ color: "#16a34a" }} />,
  buyOnly: <ShoppingCartOutlined style={{ color: "#d97706" }} />,
};

// ─── 网格价格轴组件 ─────────────────────────────────────────

function GridPriceAxis({
  levels,
  type,
}: {
  levels: GridLevelConfig[];
  type: "buy" | "sell";
}) {
  const color = type === "buy" ? BUY_COLOR : SELL_COLOR;
  const bg = type === "buy" ? BUY_BG : SELL_BG;
  const icon = type === "buy" ? <RiseOutlined /> : <FallOutlined />;
  const label = type === "buy" ? "买入档位" : "卖出档位";

  if (levels.length === 0) {
    return (
      <div style={{ flex: 1, opacity: 0.5 }}>
        <Flex align="center" gap={6} style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color, display: "inline-flex", alignItems: "center", gap: 4 }}>
            {icon} {label}
          </span>
        </Flex>
        <div style={{
          background: bg, borderRadius: 8, padding: 16,
          border: `1px dashed ${color}44`, textAlign: "center",
        }}>
          <Text type="secondary" style={{ fontSize: 12 }}>未设置</Text>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1 }}>
      <Flex align="center" gap={6} style={{ marginBottom: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color,
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>
          ({levels.length} 档)
        </span>
      </Flex>
      <div style={{
        background: bg, borderRadius: 8, padding: "4px 0",
        border: `1px solid ${color}22`,
      }}>
        {levels.map((level, i) => (
          <Flex
            key={i}
            align="center"
            justify="space-between"
            style={{
              padding: "5px 10px",
              borderBottom: i < levels.length - 1 ? `1px solid ${color}15` : "none",
            }}
          >
            <Flex align="center" gap={6}>
              <Tag color={type === "buy" ? "green" : "red"} style={{
                fontSize: 10, lineHeight: "16px", margin: 0,
                fontFamily: "var(--font-geist-mono)", minWidth: 40, textAlign: "center",
              }}>
                {level.label}
              </Tag>
              <Text strong style={{ fontSize: 13, fontFamily: "var(--font-geist-mono)", color }}>
                ¥{fmt(level.price, 2)}
              </Text>
            </Flex>
            <Tooltip title={type === "buy" ? `投入 ¥${fmt(level.cost)}` : `回收 ¥${fmt(level.cost)}`}>
              <Text style={{ fontSize: 11, color: "#6b7280", cursor: "help" }}>
                {fmtShares(level.shares)}股 · ¥{fmt(level.cost)}
              </Text>
            </Tooltip>
          </Flex>
        ))}
      </div>
    </div>
  );
}

// ─── 策略描述横幅 ──────────────────────────────────────────

function StrategyBanner({ plan, onSettings }: {
  plan: GridPlan;
  onSettings: () => void;
}) {
  const strategyColorMap: Record<GridStrategy, string> = {
    full: "#8b5cf6",
    base: "#2563eb",
    cash: "#16a34a",
    buyOnly: "#d97706",
  };
  const color = strategyColorMap[plan.strategy];
  const extraInfo = plan.strategy === "base"
    ? `底仓 ${fmtShares(plan.baseShares)} 股不卖`
    : plan.strategy === "cash"
      ? `全部 ${fmtShares(plan.positionShares)} 股做底仓`
      : plan.strategy === "buyOnly"
        ? `全部 ${fmtShares(plan.positionShares)} 股保留`
        : `最大 ${fmtShares(plan.sellLevels.reduce((s, l) => s + l.shares, 0))} 股参与网格`;

  return (
    <div style={{
      background: `${color}08`,
      borderRadius: 6, padding: "6px 10px",
      borderLeft: `3px solid ${color}`,
      marginBottom: 10,
    }}>
      <Flex align="center" justify="space-between">
        <Flex align="center" gap={8}>
          {STRATEGY_ICONS[plan.strategy]}
          <Text strong style={{ fontSize: 13, color }}>{STRATEGY_LABELS[plan.strategy]}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>· {STRATEGY_DESCRIPTIONS[plan.strategy]}</Text>
        </Flex>
        <Flex align="center" gap={8}>
          <Text style={{ fontSize: 11, color: "#6b7280" }}>{extraInfo}</Text>
          <Button size="small" icon={<SettingOutlined />} onClick={onSettings} type="text" />
        </Flex>
      </Flex>
    </div>
  );
}

// ─── 通知条 ──────────────────────────────────────────────────

function FlashMessage({ message, type }: { message: string; type: "success" | "info" }) {
  const bg = type === "success" ? "#f0fdf4" : "#eff6ff";
  const color = type === "success" ? "#16a34a" : "#2563eb";
  return (
    <div style={{
      background: bg, borderRadius: 6, padding: "6px 12px",
      border: `1px solid ${color}22`, marginBottom: 8,
      fontSize: 12, color,
    }}>
      {type === "success" ? "✅ " : "ℹ️ "}{message}
    </div>
  );
}

// ─── 单只股票网格卡片 ──────────────────────────────────────

function GridPlanCard({
  plan,
  existingAlertPrices,
  onPlanChange,
}: {
  plan: GridPlan;
  existingAlertPrices: Set<string>;
  onPlanChange: (code: StockCode, settings: Partial<GridSettings>) => void;
}) {
  const { addRule } = useAlerts();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flash, setFlash] = useState<{ message: string; type: "success" | "info" } | null>(null);
  const [localSettings, setLocalSettings] = useState<GridSettings>(() => loadStockSettings(plan.stockCode));

  const defaultStep = suggestGridStep(plan.volatility);

  // 已有告警检查
  const allAlertsExist =
    plan.buyLevels.every((l) => existingAlertPrices.has(`${plan.stockCode}:buy:${l.price}`)) &&
    plan.sellLevels.every((l) => existingAlertPrices.has(`${plan.stockCode}:sell:${l.price}`));

  // 一键添加告警
  const handleAddAlerts = useCallback(() => {
    const alerts = generateGridAlerts(plan);
    let added = 0;
    for (const a of alerts) {
      const key = a.operator === "<="
        ? `${plan.stockCode}:buy:${a.value}`
        : `${plan.stockCode}:sell:${a.value}`;
      if (!existingAlertPrices.has(key)) {
        const { label: _l, enabled: _e, ...clean } = a;
        addRule(clean);
        added++;
      }
    }
    setFlash({ message: `已添加 ${added} 条告警规则，触达时自动推微信`, type: "success" });
    setTimeout(() => setFlash(null), 4000);
  }, [plan, addRule, existingAlertPrices]);

  // 保存设置 → 触发重算
  const handleApplySettings = useCallback(() => {
    saveStockSettings(plan.stockCode, localSettings);
    setSettingsOpen(false);
    onPlanChange(plan.stockCode, localSettings);
  }, [plan.stockCode, localSettings, onPlanChange]);

  // 卖出占比
  const totalSellShares = plan.sellLevels.reduce((s, l) => s + l.shares, 0);
  const totalBuyShares = plan.buyLevels.reduce((s, l) => s + l.shares, 0);

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{
        marginBottom: 12,
        boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)",
        borderLeft: `3px solid ${CURRENT_COLOR}`,
      }}
    >
      {/* 股票标题 */}
      <Flex align="center" justify="space-between" style={{ marginBottom: 10 }}>
        <Flex align="center" gap={8}>
          <div style={{
            width: 6, height: 28, borderRadius: 3,
            background: `linear-gradient(to bottom, ${BUY_COLOR}, ${CURRENT_COLOR}, ${SELL_COLOR})`,
          }} />
          <div>
            <Text strong style={{ fontSize: 15, lineHeight: "20px" }}>{plan.stockName}</Text>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{plan.stockCode}</Text>
          </div>
        </Flex>
      </Flex>

      {/* 策略条 */}
      <StrategyBanner plan={plan} onSettings={() => setSettingsOpen(true)} />

      {/* 闪光通知 */}
      {flash && <FlashMessage {...flash} />}

      {/* ═══ 指标行 ═══ */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={4}>
          <Statistic
            title="现价"
            value={plan.currentPrice}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 16, fontWeight: 600, color: CURRENT_COLOR }}
          />
        </Col>
        <Col span={3}>
          <Statistic
            title="成本价"
            value={plan.buyPrice}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 16, fontWeight: 600 }}
          />
        </Col>
        <Col span={3}>
          <Statistic
            title="步长"
            value={plan.stepPct}
            suffix="%"
            precision={1}
            valueStyle={{ fontSize: 16, fontWeight: 600, color: "#8b5cf6" }}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title="每级股数"
            value={plan.sharesPerLevel}
            formatter={(v) => fmtShares(v as number)}
            valueStyle={{ fontSize: 16, fontWeight: 600 }}
          />
        </Col>
        <Col span={5}>
          <Tooltip title="填满所有买入网格需资金">
            <Statistic
              title={
                <span>
                  <RiseOutlined style={{ color: BUY_COLOR, marginRight: 4 }} />买入需资金
                </span>
              }
              value={plan.capitalNeeded}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 16, fontWeight: 600, color: BUY_COLOR }}
            />
          </Tooltip>
        </Col>
        <Col span={5}>
          <Tooltip title="各卖出级全部触发可回收现金">
            <Statistic
              title={
                <span>
                  <FallOutlined style={{ color: SELL_COLOR, marginRight: 4 }} />卖出可回收
                </span>
              }
              value={plan.totalProceeds}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 16, fontWeight: 600, color: SELL_COLOR }}
            />
          </Tooltip>
        </Col>
      </Row>

      {/* ═══ 网格阶梯可视化 ═══ */}
      <Flex gap={12} wrap="wrap" style={{ marginBottom: 8 }}>
        {plan.buyLevels.length > 0 && (
          <>
            <GridPriceAxis levels={plan.buyLevels} type="buy" />
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", minWidth: 52, padding: "0 4px",
            }}>
              <div style={{
                width: 2, flex: 1,
                background: `linear-gradient(to bottom, ${BUY_COLOR} 0%, ${CURRENT_COLOR} 50%, ${SELL_COLOR} 100%)`,
                borderRadius: 1, minHeight: 60,
              }} />
              <div style={{
                background: CURRENT_COLOR, color: "#fff", borderRadius: 9999,
                padding: "2px 8px", fontSize: 11, fontWeight: 700, margin: "4px 0",
                whiteSpace: "nowrap",
              }}>
                ¥{plan.currentPrice}
              </div>
              <div style={{
                width: 2, flex: 1,
                background: `linear-gradient(to bottom, ${SELL_COLOR} 0%, ${CURRENT_COLOR} 50%, ${BUY_COLOR} 100%)`,
                borderRadius: 1, minHeight: 60,
              }} />
            </div>
          </>
        )}
        {plan.sellLevels.length > 0 && (
          <GridPriceAxis levels={plan.sellLevels} type="sell" />
        )}
      </Flex>

      {/* ═══ 轻量信息 ═══ */}
      <Flex wrap="wrap" gap={4} style={{ fontSize: 11, color: "#9ca3af" }}>
        <span>持有 {fmtShares(plan.positionShares)} 股</span>
        {plan.strategy === "base" && plan.baseShares > 0 && (
          <>
            <span> ·</span>
            <span style={{ color: "#2563eb" }}>底仓 {fmtShares(plan.baseShares)} 股不动</span>
          </>
        )}
        {totalBuyShares > 0 && (
          <><span> ·</span><span>买入 {fmtShares(totalBuyShares)} 股 / {plan.buyLevels.length} 档</span></>
        )}
        {totalSellShares > 0 && (
          <><span> ·</span><span>卖出 {fmtShares(totalSellShares)} 股 / {plan.sellLevels.length} 档</span></>
        )}
        {plan.sellRatio > 0 && plan.strategy !== "buyOnly" && (
          <Tag color="red" style={{ fontSize: 10, lineHeight: "16px" }}>
            卖出占总仓位 {plan.sellRatio}%
          </Tag>
        )}
      </Flex>

      {/* ═══ 操作按钮 ═══ */}
      <Flex justify="flex-end" style={{ marginTop: 10 }}>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<BellOutlined />}
          onClick={handleAddAlerts}
          disabled={allAlertsExist}
        >
          {allAlertsExist ? "告警已全添加" : "一键生成告警 → 微信推送"}
        </Button>
      </Flex>

      {/* ═══ 设置弹窗 ═══ */}
      <Modal
        title={
          <Flex align="center" gap={8}>
            <span>{plan.stockName}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>{plan.stockCode}</Text>
          </Flex>
        }
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={handleApplySettings}
        okText="应用"
        cancelText="取消"
        width={460}
      >
        <Form layout="vertical" size="small">
          {/* 策略选择 */}
          <Form.Item label="网格策略">
            <Radio.Group
              value={localSettings.strategy}
              onChange={(e) => setLocalSettings((s) => ({
                ...s, strategy: e.target.value as GridStrategy,
              }))}
              size="small"
            >
              <Flex wrap="wrap" gap={6}>
                {(["full", "base", "cash", "buyOnly"] as GridStrategy[]).map((st) => (
                  <Radio.Button key={st} value={st}>
                    {STRATEGY_ICONS[st]} {STRATEGY_LABELS[st]}
                  </Radio.Button>
                ))}
              </Flex>
            </Radio.Group>
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
              {STRATEGY_DESCRIPTIONS[localSettings.strategy]}
            </Text>
          </Form.Item>

          <Divider style={{ margin: "8px 0" }} />

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="步长 (%)">
                <InputNumber
                  style={{ width: "100%" }}
                  min={1} max={15} step={0.5}
                  value={localSettings.stepPct || 0}
                  onChange={(v) => setLocalSettings((s) => ({ ...s, stepPct: v ?? 0 }))}
                  addonAfter="%"
                />
                <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                  建议 {defaultStep}%
                </Text>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="买入档数">
                <InputNumber
                  style={{ width: "100%" }} min={1} max={8}
                  value={localSettings.buyCount}
                  onChange={(v) => setLocalSettings((s) => ({ ...s, buyCount: v ?? 5 }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="卖出档数">
                <InputNumber
                  style={{ width: "100%" }} min={0} max={6}
                  value={localSettings.sellCount}
                  onChange={(v) => setLocalSettings((s) => ({ ...s, sellCount: v ?? 4 }))}
                />
                <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                  0=不设卖出
                </Text>
              </Form.Item>
            </Col>
          </Row>

          {/* 策略特定参数 */}
          {localSettings.strategy === "base" && (
            <Form.Item label={`底仓保留股数（持有 ${fmtShares(plan.positionShares)} 股）`}>
              <InputNumber
                style={{ width: "100%" }}
                min={0} max={plan.positionShares} step={100}
                value={localSettings.baseShares}
                onChange={(v) => setLocalSettings((s) => ({ ...s, baseShares: v ?? 0 }))}
                addonAfter="股"
              />
              {localSettings.baseShares > 0 && localSettings.baseShares < plan.positionShares && (
                <Text style={{ fontSize: 11, color: "#2563eb", display: "block", marginTop: 2 }}>
                  网格可卖 {plan.positionShares - localSettings.baseShares} 股，
                  占总仓位 {((plan.positionShares - localSettings.baseShares) / plan.positionShares * 100).toFixed(0)}%
                </Text>
              )}
            </Form.Item>
          )}

          {localSettings.strategy === "cash" && (
            <Form.Item label="每级投入现金">
              <InputNumber
                style={{ width: "100%" }}
                min={1000} step={1000}
                value={localSettings.cashPerLevel}
                onChange={(v) => setLocalSettings((s) => ({ ...s, cashPerLevel: v ?? 5000 }))}
                addonAfter="元"
              />
              <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                约 {Math.round(localSettings.cashPerLevel / plan.currentPrice)} 股/级
              </Text>
            </Form.Item>
          )}

          {/* 覆盖每级股数 */}
          {localSettings.strategy !== "cash" && (
            <Form.Item label="每级股数（0=自动）">
              <InputNumber
                style={{ width: "100%" }}
                min={0} step={100}
                value={localSettings.sharesPerLevel}
                onChange={(v) => setLocalSettings((s) => ({ ...s, sharesPerLevel: v ?? 0 }))}
                addonAfter="股"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

// ─── 本地存储 ────────────────────────────────────────────────

const STORAGE_KEY = "ts-stock-monitor:grid-settings2";

function loadStockSettings(code: StockCode): GridSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const all = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...all[code] };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveStockSettings(code: StockCode, s: GridSettings) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all: Record<string, GridSettings> = raw ? JSON.parse(raw) : {};
    all[code] = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

function loadAllStockSettings(): Record<string, GridSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const DEFAULT_SETTINGS: GridSettings = {
  strategy: "full",
  stepPct: 0,
  buyCount: 5,
  sellCount: 4,
  sharesPerLevel: 0,
  baseShares: 0,
  cashPerLevel: 5000,
};

// ─── 全局汇总卡片 ───────────────────────────────────────────

function GridSummaryHeader({ plans }: { plans: GridPlan[] }) {
  const totalCapital = plans.reduce((s, p) => s + p.capitalNeeded, 0);
  const totalProceeds = plans.reduce((s, p) => s + p.totalProceeds, 0);
  const totalMarketValue = plans.reduce((s, p) => s + p.currentPrice * p.positionShares, 0);
  const totalSellShares = plans.reduce((s, p) => s + p.sellLevels.reduce((ss, l) => ss + l.shares, 0), 0);
  const strategyCounts: Record<string, number> = {};
  for (const p of plans) {
    strategyCounts[p.strategy] = (strategyCounts[p.strategy] || 0) + 1;
  }

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{
        marginBottom: 12,
        boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)",
        background: "#faf5ff", borderLeft: "3px solid #8b5cf6",
      }}
    >
      <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
        <Flex align="center" gap={8}>
          <LineChartOutlined style={{ fontSize: 18, color: "#8b5cf6" }} />
          <Text strong style={{ fontSize: 15 }}>网格交易总览</Text>
          <Tag color="purple" style={{ fontSize: 10, lineHeight: "16px" }}>
            {plans.length} 只
          </Tag>
          <Flex gap={4}>
            {Object.entries(strategyCounts).map(([st, count]) => (
              <Tag key={st} style={{ fontSize: 9, lineHeight: "16px" }}>
                {STRATEGY_LABELS[st as GridStrategy]} ×{count}
              </Tag>
            ))}
          </Flex>
        </Flex>
        <Flex wrap="wrap" gap={16}>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: "block" }}>总需资金</Text>
            <Text strong style={{ fontSize: 16, color: BUY_COLOR }}>¥{fmt(totalCapital, 0)}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: "block" }}>可回收</Text>
            <Text strong style={{ fontSize: 16, color: SELL_COLOR }}>¥{fmt(totalProceeds, 0)}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: "block" }}>持仓市值</Text>
            <Text strong style={{ fontSize: 16 }}>¥{fmt(totalMarketValue, 0)}</Text>
          </div>
          {totalSellShares > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: "block" }}>网格股数</Text>
              <Text strong style={{ fontSize: 16 }}>{fmtShares(totalSellShares)}</Text>
            </div>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}

// ─── 主面板 ──────────────────────────────────────────────────

export default function GridTradingPanel({ stockDataMap }: GridTradingPanelProps) {
  const { positions } = usePortfolio(stockDataMap);
  const { rules } = useAlerts();

  // 从 localStorage 读取所有自定义设置
  const allSettings = useMemo(() => loadAllStockSettings(), []);

  // 按自定义设置计算网格计划
  const [refreshKey, setRefreshKey] = useState(0);

  const plans = useMemo(() => {
    return positions
      .filter((p) => {
        const sd = stockDataMap.get(p.stockCode);
        return sd?.quote.currentPrice != null;
      })
      .map((p) => {
        const custom = allSettings[p.stockCode];
        return computeGridPlan(p, stockDataMap.get(p.stockCode), custom);
      });
  }, [positions, stockDataMap, refreshKey]);

  // 已有告警价格集合（去重）
  const existingAlertPrices = useMemo(() => {
    const s = new Set<string>();
    for (const r of rules) {
      if (r.field === "currentPrice" && r.stockCode) {
        s.add(r.operator === "<="
          ? `${r.stockCode}:buy:${r.value}`
          : `${r.stockCode}:sell:${r.value}`
        );
      }
    }
    return s;
  }, [rules]);

  // 某只股票设置变化 → 触发重算
  const handlePlanChange = useCallback((code: StockCode, settings: Partial<GridSettings>) => {
    // 已通过 saveStockSettings 在子组件中保存
    setRefreshKey((k) => k + 1);
  }, []);

  if (positions.length === 0) {
    return (
      <Card size="small" style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}>
        <Empty description="暂无持仓，请先在「持仓」面板添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  if (plans.length === 0) {
    return (
      <Card size="small" style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}>
        <Empty description="行情数据加载中..." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  return (
    <div>
      <GridSummaryHeader plans={plans} />
      {plans.map((plan) => (
        <GridPlanCard
          key={plan.stockCode}
          plan={plan}
          existingAlertPrices={existingAlertPrices}
          onPlanChange={handlePlanChange}
        />
      ))}
      <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
        网格交易仅供参考 · 点⚙️切换策略 · 「一键生成告警」在价格触达时推送微信
      </div>
    </div>
  );
}
