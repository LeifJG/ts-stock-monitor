// ============================================================
// grid-engine.ts — N. 网格交易计算引擎
// ============================================================
// 纯函数，根据持仓+行情+策略模式计算网格计划。
// 支持 4 种策略：全仓、底仓、现金加仓、仅买入

import type {
  Position,
  StockCode,
  StockData,
  GridPlan,
  GridLevelConfig,
  GridSettings,
  GridStrategy,
  AlertRule,
} from "./types";

// ─── 默认参数 ──────────────────────────────────────────────────

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  strategy: "full",
  stepPct: 0,          // 0 = 自动基于波动率
  buyCount: 5,
  sellCount: 4,
  sharesPerLevel: 0,   // 0 = 自动
  baseShares: 0,       // 底仓保留股数
  cashPerLevel: 5000,  // 现金模式每级投入
};

// ─── 策略中文名称 ──────────────────────────────────────────────

export const STRATEGY_LABELS: Record<GridStrategy, string> = {
  full: "全仓网格",
  base: "底仓+网格",
  cash: "现金加仓",
  buyOnly: "仅买入",
};

export const STRATEGY_DESCRIPTIONS: Record<GridStrategy, string> = {
  full: "用现有持仓的 30% 做网格，买卖双向自动循环",
  base: "设定底仓保留不卖，仅用超出部分做（卖出）网格",
  cash: "从现金池分配固定金额买入，涨了卖出该批次获利",
  buyOnly: "只设买入档位，跌了补仓，不设卖出触发",
};

// ─── 计算波动率 ────────────────────────────────────────────────

export function estimateVolatility(
  currentPrice: number,
  buyPrice: number,
): number {
  const diff = Math.abs(currentPrice - buyPrice) / buyPrice * 100;
  return Math.max(3, Math.min(diff * 0.7, 25));
}

// ─── 网格步长 ──────────────────────────────────────────────────

export function suggestGridStep(volatility: number): number {
  return Math.max(2, Math.round(volatility * 0.5 * 10) / 10);
}

// ─── 计算单只股票的网格计划 ─────────────────────────────────────

export function computeGridPlan(
  position: Position,
  stockData: StockData | undefined,
  settings?: Partial<GridSettings>,
): GridPlan {
  const s: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...settings };

  const currentPrice = stockData?.quote.currentPrice ?? position.buyPrice;
  const buyPrice = position.buyPrice;
  const totalShares = position.shares;

  // 波动率 & 步长
  const volatility = estimateVolatility(currentPrice, buyPrice);
  const stepPct = s.stepPct > 0 ? s.stepPct : suggestGridStep(volatility);
  const buyCount = Math.max(1, Math.min(s.buyCount, 8));
  const sellCount = Math.max(1, Math.min(s.sellCount, 6));

  // ── 根据策略决定每级股数 ──
  let sharesPerLevel: number;
  let baseShares: number;
  let cashPerLevel: number;

  switch (s.strategy) {
    case "base": {
      // 底仓模式：保留 baseShares 不卖，用超出部分做卖出网格
      baseShares = Math.min(s.baseShares || Math.round(totalShares * 0.5), totalShares);
      const gridShares = totalShares - baseShares;   // 可用于网格的股数
      if (gridShares <= 0) {
        // 持仓全部是底仓 — 退化为仅买入
        sharesPerLevel = Math.round(totalShares * 0.15);
        baseShares = totalShares;
      } else {
        // 卖出网格按可用股数 ÷ 卖出档数, 买入用等量资金
        sharesPerLevel = Math.max(100, Math.round(gridShares / Math.max(sellCount, 1) / 100) * 100);
      }
      break;
    }
    case "cash": {
      // 现金模式：每级固定金额，由 cashPerLevel 决定股数
      cashPerLevel = Math.max(100, s.cashPerLevel);
      sharesPerLevel = Math.max(100, Math.round(cashPerLevel / currentPrice / 100) * 100);
      baseShares = totalShares; // 全部持仓做底仓不参与网格卖出
      break;
    }
    case "buyOnly": {
      // 仅买入：不卖出现有持仓
      sharesPerLevel = Math.max(100, Math.round(totalShares * 0.3 / Math.max(buyCount, 1) / 100) * 100);
      baseShares = totalShares;
      break;
    }
    default: // "full"
      sharesPerLevel = Math.max(100, Math.round(totalShares * 0.3 / Math.max(buyCount, 1) / 100) * 100);
      baseShares = 0;
      break;
  }

  // ── 买入网格 ──
  const buyLevels: GridLevelConfig[] = [];
  for (let i = 1; i <= buyCount; i++) {
    const pct = -(stepPct * i);
    const price = parseFloat((currentPrice * (1 + pct / 100)).toFixed(2));
    if (price <= 0) continue;
    buyLevels.push({
      type: "buy",
      price,
      pct: parseFloat(pct.toFixed(1)),
      shares: sharesPerLevel,
      cost: parseFloat((price * sharesPerLevel).toFixed(2)),
      label: `↓${Math.abs(pct).toFixed(0)}%`,
    });
  }

  // ── 卖出网格 ──
  const sellLevels: GridLevelConfig[] = [];
  const canSell = s.strategy !== "buyOnly";
  if (canSell) {
    for (let i = 1; i <= sellCount; i++) {
      const pct = stepPct * i;
      const price = parseFloat((currentPrice * (1 + pct / 100)).toFixed(2));
      sellLevels.push({
        type: "sell",
        price,
        pct: parseFloat(pct.toFixed(1)),
        shares: sharesPerLevel,
        cost: parseFloat((price * sharesPerLevel).toFixed(2)),
        label: `↑${pct.toFixed(0)}%`,
      });
    }
  }

  // 统计
  const capitalNeeded = buyLevels.reduce((sum, l) => sum + l.cost, 0);
  const totalProceeds = sellLevels.reduce((sum, l) => sum + l.cost, 0);

  // 卖出占总仓位比例
  const sellRatio = totalShares > 0
    ? (sellLevels.reduce((s, l) => s + l.shares, 0) / totalShares * 100)
    : 0;

  return {
    stockCode: position.stockCode,
    stockName: stockData?.quote.name ?? position.stockName,
    currentPrice,
    buyPrice,
    volatility: parseFloat(volatility.toFixed(1)),
    stepPct,
    buyLevels,
    sellLevels,
    positionShares: totalShares,
    sharesPerLevel,
    capitalNeeded: parseFloat(capitalNeeded.toFixed(2)),
    totalProceeds: parseFloat(totalProceeds.toFixed(2)),
    strategy: s.strategy,
    baseShares,
    sellRatio: parseFloat(sellRatio.toFixed(0)),
  };
}

// ─── 批量计算 ──────────────────────────────────────────────────

export function computeAllGridPlans(
  positions: Position[],
  stockDataMap: Map<string, StockData>,
  settings?: Partial<GridSettings>,
): GridPlan[] {
  return positions
    .filter((p) => {
      const sd = stockDataMap.get(p.stockCode);
      return sd?.quote.currentPrice != null;
    })
    .map((p) => computeGridPlan(p, stockDataMap.get(p.stockCode), settings));
}

// ─── 网格告警规则生成 ──────────────────────────────────────────

export function generateGridAlerts(
  plan: GridPlan,
): Omit<AlertRule, "id">[] {
  const rules: Omit<AlertRule, "id">[] = [];

  for (const level of plan.buyLevels) {
    rules.push({
      stockCode: plan.stockCode,
      field: "currentPrice",
      operator: "<=",
      value: level.price,
      label: `📐 ${STRATEGY_LABELS[plan.strategy]}：${level.label} 买入价 ≤ ¥${level.price}`,
      enabled: true,
      alertType: "field",
      pushToMobile: true,
    });
  }

  for (const level of plan.sellLevels) {
    rules.push({
      stockCode: plan.stockCode,
      field: "currentPrice",
      operator: ">=",
      value: level.price,
      label: `📐 ${STRATEGY_LABELS[plan.strategy]}：${level.label} 卖出价 ≥ ¥${level.price}`,
      enabled: true,
      alertType: "field",
      pushToMobile: true,
    });
  }

  return rules;
}
