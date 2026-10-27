// ============================================================
// tests/cash-plan.test.ts — 现金仓位分析规则
// ------------------------------------------------------------
// 锁定：
//   1. 现金占比的分母是「股票市值 + 现金」，不是投入成本
//   2. 保留区间由市场估值分位决定：越贵留越多（便宜时死守大额现金是机会成本）
//   3. 三档结论必须给出可执行动作，而不是空话
// ============================================================

import { describe, it, expect } from "vitest";
import { cashRatio, recommendedCashBand, buildCashPlan } from "@/lib/cash-plan";

describe("现金占比", () => {
  it("分母是股+现金", () => {
    expect(cashRatio(200000, 800000)).toBe(20);
  });
  it("全现金 / 全股票", () => {
    expect(cashRatio(100000, 0)).toBe(100);
    expect(cashRatio(0, 100000)).toBe(0);
  });
  it("都为 0 返回 null，不产生 0/0", () => {
    expect(cashRatio(0, 0)).toBeNull();
    expect(cashRatio(null, null)).toBeNull();
  });
});

describe("保留区间（市场越贵留越多）", () => {
  it("分位 90（很贵）→ 30-45%", () => {
    const b = recommendedCashBand(90);
    expect(b.min).toBe(30);
    expect(b.max).toBe(45);
  });
  it("分位 55（中性）→ 18-28%", () => {
    expect(recommendedCashBand(55)).toMatchObject({ min: 18, max: 28 });
  });
  it("分位 10（便宜）→ 8-15%，不鼓励守大额现金", () => {
    const b = recommendedCashBand(10);
    expect(b.max).toBeLessThanOrEqual(15);
  });
  it("缺数据给中性区间而不是崩", () => {
    expect(recommendedCashBand(null).label).toContain("中性");
  });
});

describe("仓位方案三档", () => {
  const base = { stockValue: 1000000, marketPct: 70 };  // 建议 25-35%

  it("现金 5% → short，并给出补到下限的缺口", () => {
    const p = buildCashPlan({ ...base, cash: 50000 });
    expect(p.level).toBe("short");
    expect(p.ratioPct).toBeCloseTo(4.8, 1);
    expect(p.gapToMin).toBeGreaterThan(0);
    expect(p.actions.join(" ")).toContain("不要靠融资");
  });

  it("现金 30% → ok", () => {
    // 总资产 = 30万现金 + 70万股票 → 30%
    const p = buildCashPlan({ cash: 300000, stockValue: 700000, marketPct: 70 });
    expect(p.level).toBe("ok");
    expect(p.gapToMin).toBe(0);
    expect(p.excessAboveMax).toBe(0);
  });

  it("现金 60% → excess，并算出富余金额与停泊收益", () => {
    const p = buildCashPlan({ cash: 600000, stockValue: 400000, marketPct: 70, parkingRate: 1.37 });
    expect(p.level).toBe("excess");
    expect(p.excessAboveMax).toBeGreaterThan(0);
    expect(p.actions.join(" ")).toContain("逆回购");
  });

  it("没记录现金时不硬判，先要求填数", () => {
    const p = buildCashPlan({ cash: 0, stockValue: 0, marketPct: 70 });
    expect(p.level).toBe("ok");
    expect(p.headline).toContain("还没有记录");
  });

  it("有折价标的时提示分批补仓", () => {
    const p = buildCashPlan({ ...base, cash: 100000, cheapHoldingCount: 3 });
    expect(p.actions.join(" ")).toContain("折价标的");
  });
});
