// ============================================================
// tests/erp.test.ts — 股债性价比（ERP）与债券位置判定
// ------------------------------------------------------------
// 锁定两件事：
//   1. ERP = 盈利收益率(1/PE) − 10 年国债收益率，PE 非法必须返回 null 而不是乱算
//   2. 债券「贵不贵」看收益率历史分位：分位低（利率在历史低位）= 债贵，
//      不能被解读成「债券便宜可以买」
// ============================================================

import { describe, it, expect } from "vitest";
import {
  earningsYield,
  erp,
  bondPositionVerdict,
  erpVerdict,
  priceImpactIfRateUp1Pct,
} from "@/lib/erp";

describe("盈利收益率", () => {
  it("1/PE×100", () => {
    expect(earningsYield(12.5)).toBeCloseTo(8.0, 5);
    expect(earningsYield(7.53)).toBeCloseTo(13.28, 2);
  });
  it("PE 非法返回 null", () => {
    expect(earningsYield(0)).toBeNull();
    expect(earningsYield(-5)).toBeNull();
    expect(earningsYield(null)).toBeNull();
    expect(earningsYield(NaN)).toBeNull();
  });
});

describe("股债性价比 ERP", () => {
  it("沪深300 PE12.48 − 国债1.64 → 6.37", () => {
    expect(erp(12.48, 1.64)).toBeCloseTo(6.37, 2);
  });
  it("中证红利 PE7.53 − 1.64 → 11.64（股票显著便宜）", () => {
    const v = erp(7.53, 1.64)!;
    expect(v).toBeCloseTo(11.64, 2);
    expect(erpVerdict(v).level).toBe("good");
  });
  it("缺国债或 PE 返回 null", () => {
    expect(erp(12.48, null)).toBeNull();
    expect(erp(null, 1.64)).toBeNull();
  });
  it("ERP 分档：≥8 股票显著便宜 / ≥5 股票占优 / 0-2 债略占优 / 负 债券占优", () => {
    expect(erpVerdict(8).label).toContain("显著便宜");
    expect(erpVerdict(5).label).toContain("股票占优");
    expect(erpVerdict(1).label).toContain("债略占优");
    expect(erpVerdict(-1).level).toBe("bad");
  });
});

describe("债券位置判定（看收益率历史分位）", () => {
  it("10Y 收益率处于 2.1% 分位 → 债贵，不能翻译成便宜", () => {
    const v = bondPositionVerdict(2.1);
    expect(v.level).toBe("bad");
    expect(v.label).toContain("债贵");
    expect(v.label).not.toContain("便宜");
  });
  it("分位 95% → 利率高位、债券便宜", () => {
    const v = bondPositionVerdict(95);
    expect(v.level).toBe("good");
    expect(v.label).toContain("便宜");
  });
  it("缺数据不硬判", () => {
    expect(bondPositionVerdict(null).label).toBe("数据不足");
    expect(bondPositionVerdict(undefined).label).toBe("数据不足");
  });
});

describe("久期→利率敏感度", () => {
  it("久期 18 年，利率上行 1% → 约 -18%", () => {
    expect(priceImpactIfRateUp1Pct(18)).toBe(-18);
  });
  it("货币基金久期 0.1 → 几乎无影响", () => {
    expect(priceImpactIfRateUp1Pct(0.1)).toBe(-0.1);
  });
  it("缺数据返回 null", () => {
    expect(priceImpactIfRateUp1Pct(null)).toBeNull();
  });
});
