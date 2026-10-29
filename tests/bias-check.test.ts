// ============================================================
// tests/bias-check.test.ts — 下单前偏误自检
// ------------------------------------------------------------
// 锁定：
//   1. 四问答「否」越多越不该动手（0 → 可做 / 1 → 减半 / ≥2 → 等 24 小时）
//   2. 自动信号只在高危场景触发：贴近成本价（锚定）、有模型叙述（叙事）、
//      深亏且要卖/补（损失厌恶）、现金不足还要补（弹药）
//   3. 不会因为「浮亏」就无脑报信号——必须同时有买卖动作才算
// ============================================================

import { describe, it, expect } from "vitest";
import { biasVerdict, biasSignals, BIAS_QUESTIONS } from "@/lib/bias-check";

const allOk = {
  valuationNotCost: true,
  numbersNotStory: true,
  wouldActIfFlat: true,
  canStateCounter: true,
};

describe("四问结论", () => {
  it("全过 → go", () => {
    const v = biasVerdict(allOk);
    expect(v.level).toBe("go");
    expect(v.triggered).toHaveLength(0);
  });

  it("1 项不过 → caution，并指出是哪个偏误", () => {
    const v = biasVerdict({ ...allOk, valuationNotCost: false });
    expect(v.level).toBe("caution");
    expect(v.triggered[0].risk).toContain("锚定");
  });

  it("≥2 项不过 → stop，建议等 24 小时", () => {
    const v = biasVerdict({ ...allOk, wouldActIfFlat: false, numbersNotStory: false });
    expect(v.level).toBe("stop");
    expect(v.advice).toContain("24 小时");
    expect(v.triggered).toHaveLength(2);
  });

  it("四问覆盖锚定/叙事/损失厌恶/过度自信", () => {
    const risks = BIAS_QUESTIONS.map((q) => q.risk).join(" ");
    expect(risks).toContain("锚定");
    expect(risks).toContain("叙事");
    expect(risks).toContain("损失厌恶");
    expect(risks).toContain("过度自信");
  });
});

describe("自动信号", () => {
  const base = {
    price: 100, cost: 100, profitPct: 0, fairValue: 100,
    hasNarrative: false, action: null, cash: null, cashFloorNeeded: null,
  } as unknown as Parameters<typeof biasSignals>[0];

  it("现价贴成本价 → 锚定信号", () => {
    const sig = biasSignals({ ...base, price: 101, cost: 100 } as never);
    expect(sig.some((s) => s.kind === "anchor")).toBe(true);
  });

  it("远离成本价 → 不报锚定", () => {
    const sig = biasSignals({ ...base, price: 130, cost: 100 } as never);
    expect(sig.some((s) => s.kind === "anchor")).toBe(false);
  });

  it("有模型叙述 → 叙事信号", () => {
    const sig = biasSignals({ ...base, price: 200, cost: 300, hasNarrative: true } as never);
    expect(sig.some((s) => s.kind === "story")).toBe(true);
  });

  it("深亏 + 卖出动作 → 损失厌恶信号", () => {
    const sig = biasSignals({ ...base, price: 60, cost: 100, profitPct: -40, action: "部分止盈" } as never);
    expect(sig.some((s) => s.kind === "loss")).toBe(true);
  });

  it("深亏但没有动作 → 不报损失厌恶", () => {
    const sig = biasSignals({ ...base, price: 60, cost: 100, profitPct: -40, action: null } as never);
    expect(sig.some((s) => s.kind === "loss")).toBe(false);
  });

  it("现金不足还要补仓 → 弹药信号", () => {
    const sig = biasSignals({ ...base, price: 50, cost: 100, action: "补仓 1000 股", cash: 1000, cashFloorNeeded: 100000 } as never);
    expect(sig.some((s) => s.kind === "cash")).toBe(true);
  });
});
