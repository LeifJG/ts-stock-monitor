// ============================================================
// tests/safety-labels.test.ts — 日报「安全边际」文案测试
// ------------------------------------------------------------
// 锁死两件事：
//   1. 安全边际 = 现价 vs 合理估值（估值口径），不是网格距离
//   2. 网格距离只做中性表述，不再出现「下行空间仅 2%（风险较高）」这类
//      把「波动小」说成「风险高」的误导文案（招行/长电曾被这样标注）
// ============================================================

import { describe, it, expect } from "vitest";
import { valuationMarginLabel, gridDistanceLabel } from "@/lib/safety-labels";

describe("估值安全边际标签", () => {
  it("折价 20% 以上 → 安全边际厚", () => {
    expect(valuationMarginLabel(-33)).toContain("安全边际厚");
    expect(valuationMarginLabel(-20)).toContain("安全边际厚");
  });

  it("折价 5%~20% → 有安全边际", () => {
    expect(valuationMarginLabel(-18.5)).toContain("有安全边际");
    expect(valuationMarginLabel(-6)).toContain("有安全边际");
  });

  it("±5% 以内 → 估值合理，并标注方向", () => {
    expect(valuationMarginLabel(0)).toBe("🟡 估值合理");
    expect(valuationMarginLabel(3)).toContain("溢价 3%");
    expect(valuationMarginLabel(-3)).toContain("折价 3%");
  });

  it("溢价 5%~15% → 已高于合理估值", () => {
    expect(valuationMarginLabel(8.2)).toContain("已高于合理估值");
    expect(valuationMarginLabel(5.5)).toContain("已高于合理估值");
  });

  it("溢价 15% 以上 → 估值透支", () => {
    expect(valuationMarginLabel(16)).toContain("估值透支");
  });

  it("缺数据返回空串，不硬编造标签", () => {
    expect(valuationMarginLabel(null)).toBe("");
    expect(valuationMarginLabel(undefined)).toBe("");
    expect(valuationMarginLabel(NaN)).toBe("");
  });
});

describe("网格距离标签（中性）", () => {
  it("只描述距离，不做风险判断", () => {
    const s = gridDistanceLabel(2.3);
    expect(s).toBe("距首档补仓 2%");
    expect(s).not.toContain("风险");
    expect(s).not.toContain("安全垫");
  });

  it("缺数据返回空串", () => {
    expect(gridDistanceLabel(null)).toBe("");
    expect(gridDistanceLabel(undefined)).toBe("");
  });
});
