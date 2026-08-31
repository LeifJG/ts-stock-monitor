// ============================================================
// trade-advice.test.ts — 交易建议引擎单测
// 覆盖：估值分位融合/PB兜底、金融股负债豁免、价位单调性、
//       模型分歧保守值、股息率加权、港币符号、风控提示
// ============================================================
import { describe, it, expect } from "vitest";
import { computeTradeAdvice, computePositionLevels } from "@/lib/trade-advice";
import type { StockData } from "@/lib/types";
import type { ValuationData } from "@/app/api/valuation/route";

// ── 测试工厂 ──
function mkStock(over: Partial<StockData> = {}): StockData {
  return {
    quote: { code: "600519", name: "贵州茅台", currentPrice: 100, prevClose: 100, changePercent: 0, changeAmount: 0, high: 100, low: 100, volume: 0, amount: 0, timestamp: 0 },
    fundamentals: { pe: 20, pb: 5, dividendYield: 3, roe: 30, debtRatio: 20, roic: 25, grossMargin: 90, fcfToNetProfit: 1 },
    ...over,
  } as StockData;
}

function mkVal(over: Partial<ValuationData> = {}): ValuationData {
  return {
    code: "600519", price: 100, pe_ttm: 20, pb: 5, pe_median_5y: 25, pb_median_5y: 4,
    updated_at: "2026-08-30", pe_pct_5y: 50, pb_pct_5y: 50, pe_min_5y: 10, pe_max_5y: 40,
    pb_min_5y: 2, pb_max_5y: 8,
    ...over,
  } as ValuationData;
}

describe("computeTradeAdvice — 估值分位", () => {
  it("PE/PB 分位齐备时按 6:4 融合（PE 20 + PB 40 → 融合 28 → 偏低）", () => {
    const a = computeTradeAdvice(mkStock(), mkVal({ pe_pct_5y: 20, pb_pct_5y: 40 }));
    expect(a).not.toBeNull();
    expect(a!.reasons.join()).toContain("PE/PB 分位融合 28%");
  });

  it("亏损股（PE<0）PE 分位无效 → 回落 PB 分位评估", () => {
    const a = computeTradeAdvice(
      mkStock({ fundamentals: { pe: -12, pb: 2.5, dividendYield: null, roe: -5, debtRatio: 40 } } as Partial<StockData> as StockData),
      mkVal({ pe_pct_5y: 55, pb_pct_5y: 8 })
    );
    expect(a).not.toBeNull();
    expect(a!.reasons.join()).toContain("PB 5年分位 8%");
    expect(a!.reasons.join()).toContain("亏损股 PE 无效");
  });

  it("分位历史高位 → 不给出买入类建议", () => {
    const a = computeTradeAdvice(mkStock(), mkVal({ pe_pct_5y: 92, pb_pct_5y: 95 }));
    expect(a).not.toBeNull();
    // 基本面优秀的公司估值高位 → 持有不追高（符合价值派"不卖伟大公司"逻辑）
    expect(["hold", "watch", "avoid"]).toContain(a!.action);
    expect(a!.risks.join()).toContain("历史高位");
  });
});

describe("computeTradeAdvice — 关键价位单调性", () => {
  it("低估时：加仓 < 合理估值 < 减仓 < 止盈", () => {
    // 现价 100，模型估值 130（低估）
    const stock = mkStock({ safetyScore: { score: 30, models: { growth: { value: 130 }, ddm: { value: 126 } } } } as Partial<StockData> as StockData);
    const a = computeTradeAdvice(stock, mkVal());
    expect(a!.fairValue).not.toBeNull();
    expect(a!.addMorePrice!).toBeLessThan(a!.fairValue!);
    expect(a!.reducePrice!).toBeGreaterThan(a!.fairValue!);
    expect(a!.targetPrice!).toBeGreaterThan(a!.reducePrice!);
  });

  it("高估时：现价高于合理估值，减仓价不高于现价+5%", () => {
    // 现价 100，模型估值 80（高估）
    const stock = mkStock({ safetyScore: { score: -30, models: { growth: { value: 80 }, ddm: { value: 78 } } } } as Partial<StockData> as StockData);
    const a = computeTradeAdvice(stock, mkVal());
    expect(a!.reducePrice!).toBeLessThanOrEqual(105.01);
    // 基本面好但价格高估 → 至少观望，不会建议买入
    expect(["watch", "avoid"]).toContain(a!.action);
  });

  it("无安全边际模型时退化为技术位（现价±）", () => {
    const a = computeTradeAdvice(mkStock({ safetyScore: undefined } as Partial<StockData> as StockData), mkVal());
    expect(a!.fairValue).toBeNull();
    expect(a!.addMorePrice).toBeCloseTo(90, 0);
    expect(a!.reducePrice).toBeCloseTo(115, 0);
  });
});

describe("computeTradeAdvice — 模型分歧", () => {
  it("两模型分歧 >50% 时取保守值并提示", () => {
    const stock = mkStock({ safetyScore: { score: 10, models: { growth: { value: 150 }, ddm: { value: 60 } } } } as Partial<StockData> as StockData);
    const a = computeTradeAdvice(stock, mkVal());
    expect(a!.fairValue).toBe(60); // min(150, 60)
    expect(a!.risks.join()).toContain("分歧较大");
  });
});

describe("computeTradeAdvice — 金融股负债豁免", () => {
  it("银行股（601398 工商银行）负债率 92% 不再拖累综合评分", () => {
    const bank = mkStock({
      quote: { code: "601398", name: "工商银行", currentPrice: 6, prevClose: 6, changePercent: 0, changeAmount: 0, high: 6, low: 6, volume: 0, amount: 0, timestamp: 0 },
      fundamentals: { pe: 5, pb: 0.6, dividendYield: 6, roe: 11, debtRatio: 92, roic: null, grossMargin: null, fcfToNetProfit: null },
    } as Partial<StockData> as StockData);
    const withBank = computeTradeAdvice(bank, mkVal({ code: "601398" }));
    // 同样基本面但非金融前缀 + 相同负债率 → 被扣分，综合评分应低于银行股
    const nonBank = mkStock({
      quote: { ...bank.quote, code: "999999", name: "假公司" },
      fundamentals: bank.fundamentals,
    } as Partial<StockData> as StockData);
    const withoutBank = computeTradeAdvice(nonBank, mkVal({ code: "999999" }));
    expect(withBank!.compositeScore!).toBeGreaterThan(withoutBank!.compositeScore!);
  });
});

describe("computeTradeAdvice — 股息率加权", () => {
  it("高股息 7% 提升理由与加权（≥6 档）", () => {
    const a = computeTradeAdvice(mkStock({ fundamentals: { pe: 20, pb: 5, dividendYield: 7, roe: 30, debtRatio: 20 } } as Partial<StockData> as StockData), mkVal());
    expect(a!.reasons.join()).toContain("股息率 7.0% — 高股息防御性佳");
  });
});

describe("computeTradeAdvice — 港股", () => {
  it("港股 summary 货币符号为 HK$", () => {
    const hk = mkStock({ quote: { code: "00700", name: "腾讯控股", currentPrice: 453, prevClose: 450, changePercent: 0.7, changeAmount: 3, high: 455, low: 449, volume: 0, amount: 0, timestamp: 0 } } as Partial<StockData> as StockData);
    const stock = { ...hk, safetyScore: { score: 20, models: { growth: { value: 500 }, ddm: { value: 480 } } } } as Partial<StockData> as StockData;
    const a = computeTradeAdvice(stock, mkVal({ code: "00700", price: 453 }));
    if (a!.fairValue != null && a!.fairValue > 453) {
      expect(a!.summary).toContain("HK$");
    }
  });
});

describe("computePositionLevels — 参数统一", () => {
  it("分位 <10% 时止损放宽到 -12%（与主函数一致）", () => {
    const r = computePositionLevels(100, undefined, mkVal({ pe_pct_5y: 8 }));
    expect(r.stopLoss).toBeCloseTo(88, 0);
    expect(r.takeProfit).toBeCloseTo(130, 0);
  });

  it("分位 >80% 时止损收紧到 -6%", () => {
    const r = computePositionLevels(100, undefined, mkVal({ pe_pct_5y: 90 }));
    expect(r.stopLoss).toBeCloseTo(94, 0);
  });

  it("无分位数据时默认 +20% / -8%", () => {
    const r = computePositionLevels(100);
    expect(r.takeProfit).toBeCloseTo(120, 0);
    expect(r.stopLoss).toBeCloseTo(92, 0);
  });

  it("亏损股 PE 无效 → PB 分位兜底", () => {
    const r = computePositionLevels(100, undefined, mkVal({ pe_pct_5y: null as unknown as number, pb_pct_5y: 5 }));
    expect(r.stopLoss).toBeCloseTo(88, 0); // 分位 5% < 10% → 12%
  });
});
