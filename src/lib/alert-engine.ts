// ============================================================
// alert-engine.ts — 告警规则引擎（纯函数，无副作用）
// ============================================================
// 职责：给定一组规则和一组股票数据，返回所有被触发的告警。
// 可被前端和 API 路由复用，核心逻辑为纯函数，便于测试。

import type {
  AlertRule,
  AlertField,
  AlertOperator,
  AlertTrigger,
  StockData,
} from "./types";
import { FIELD_LABELS, FIELD_UNITS } from "./constants";

// ─── 取值器 ─────────────────────────────────────────────────────

/** 从 StockData 中提取指定字段的值 */
function getFieldValue(data: StockData, field: AlertField): number | null {
  switch (field) {
    case "currentPrice":
      return data.quote.currentPrice;
    case "changePercent":
      return data.quote.changePercent;
    case "pe":
      return data.fundamentals.pe;
    case "pb":
      return data.fundamentals.pb;
    case "marketCap":
      return data.fundamentals.marketCap;
    case "dividendYield":
      return data.fundamentals.dividendYield;
  }
}

// ─── 比较器 ─────────────────────────────────────────────────────

function compare(
  actual: number,
  operator: AlertOperator,
  threshold: number
): boolean {
  switch (operator) {
    case ">":  return actual > threshold;
    case ">=": return actual >= threshold;
    case "<":  return actual < threshold;
    case "<=": return actual <= threshold;
    case "==": return actual === threshold;
  }
}

// ─── 规则生成器 ──────────────────────────────────────────────────

/** 告警字段 → 中文标签（带单位） */
export function formatFieldLabel(field: AlertField): string {
  return FIELD_LABELS[field] ?? field;
}

/** 为一条规则生成人类可读的描述 */
export function describeRule(rule: AlertRule): string {
  const label = formatFieldLabel(rule.field);
  const unit = FIELD_UNITS[rule.field] ?? "";
  if (rule.stockCode) {
    return `${rule.stockCode} - ${label} ${rule.operator} ${rule.value}${unit}`;
  }
  return `全局 - ${label} ${rule.operator} ${rule.value}${unit}`;
}

// ─── 核心评估 ────────────────────────────────────────────────────

/** 评估一组规则，返回所有被触发的告警 */
export function evaluateAlerts(
  rules: AlertRule[],
  stockDataMap: Map<string, StockData>
): AlertTrigger[] {
  const triggers: AlertTrigger[] = [];

  rules
    .filter((r) => r.enabled)
    .forEach((rule) => {
      // 全局规则或针对特定股票的规则
      const targetCodes = rule.stockCode
        ? [rule.stockCode]
        : Array.from(stockDataMap.keys());

      targetCodes.forEach((code) => {
        const data = stockDataMap.get(code);
        if (!data) return;

        const value = getFieldValue(data, rule.field);
        if (value === null) return;

        if (compare(value, rule.operator, rule.value)) {
          triggers.push({
            ruleId: rule.id,
            ruleLabel: rule.label || describeRule(rule),
            stockCode: code,
            stockName: data.quote.name,
            field: rule.field,
            currentValue: value,
            threshold: rule.value,
            operator: rule.operator,
          });
        }
      });
    });

  return triggers;
}
