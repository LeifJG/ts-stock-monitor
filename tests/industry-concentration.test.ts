// ============================================================
// tests/industry-concentration.test.ts — 持仓行业集中度
// ------------------------------------------------------------
// 锁定：
//   1. 聚合必须按**市值**加权，不能按只数（10 只各 3% ≠ 1 只 30%）
//   2. HHI = Σ(份额%)²，单一行业 100% 时 = 10000
//   3. 阈值：单一行业 ≥50% 高度集中；≥30%（或 HHI≥2500）偏集中；
//      HHI≥1500 中度；其余分散
//   4. 未分类市值占比 ≥10% 必须提示"结论仅供参考"
// ============================================================

import { describe, it, expect } from "vitest";
import {
  aggregateByValue,
  hhi,
  concentrationMetrics,
  concentrationVerdict,
  type IndustryHolding,
} from "@/lib/industry-concentration";

const mk = (code: string, l1: string, value: number, l2?: string, name?: string): IndustryHolding => ({
  code, l1, value, l2, name,
});

describe("按市值聚合", () => {
  it("同行业合并、按市值降序、占比加总 100%", () => {
    const slices = aggregateByValue([
      mk("888001", "电子", 600000),
      mk("888002", "银行", 300000),
      mk("888003", "电子", 100000),
    ]);
    expect(slices[0].industry).toBe("电子");
    expect(slices[0].value).toBe(700000);
    expect(slices[0].pct).toBe(70);
    expect(slices[0].count).toBe(2);
    expect(Math.round(slices.reduce((s, x) => s + x.pct, 0))).toBe(100);
  });

  it("只数口径与市值口径会得出不同结论（这就是要按市值的原因）", () => {
    // 10 只各 3%（食品饮料）vs 1 只 70%（电子）
    const items = [mk("888100", "电子", 700)];
    for (let i = 0; i < 10; i++) items.push(mk(`88810${i}`, "食品饮料", 30));
    const slices = aggregateByValue(items);
    expect(slices[0].industry).toBe("电子");
    expect(slices[0].pct).toBe(70);
    // 只数口径会说食品饮料最多（10 只），市值口径必须判电子集中
    expect(slices[1].count).toBe(10);
    expect(slices[1].pct).toBe(30);
  });

  it("无有效市值时返回空，不产生 NaN", () => {
    expect(aggregateByValue([])).toEqual([]);
    expect(aggregateByValue([mk("888001", "电子", 0)])).toEqual([]);
  });
});

describe("HHI", () => {
  it("单一行业 100% → 10000", () => {
    expect(hhi([100])).toBe(10000);
  });
  it("均分两个行业 → 5000（Σ25²+25²=1250）", () => {
    expect(hhi([50, 50])).toBe(5000);
  });
  it("均分 10 个行业 → 1000（分散）", () => {
    expect(hhi(new Array(10).fill(10))).toBe(1000);
  });
});

describe("集中度判定", () => {
  const m = (over: Partial<ReturnType<typeof concentrationMetrics>>) => ({
    top1: 0, top1Industry: null, top3: 0, hhi: 0, industryCount: 0, unclassifiedPct: 0, ...over,
  });

  it("单一行业 60% → 高度集中且报警", () => {
    const v = concentrationVerdict(m({ top1: 60, top1Industry: "电子", top3: 80, hhi: 4000 }));
    expect(v.level).toBe("dangerous");
    expect(v.alerts.join(" ")).toContain("电子");
    expect(v.alerts.join(" ")).toContain("过半");
  });

  it("单一行业 35% → 偏集中", () => {
    const v = concentrationVerdict(m({ top1: 35, top1Industry: "银行", top3: 65, hhi: 2000 }));
    expect(v.level).toBe("concentrated");
    expect(v.alerts.join(" ")).toContain("30%");
  });

  it("HHI 2000 但 top1 只有 20% → 中度分散", () => {
    const v = concentrationVerdict(m({ top1: 20, top1Industry: "电子", top3: 55, hhi: 2000, industryCount: 6 }));
    expect(v.level).toBe("moderate");
  });

  it("真正分散 → diversified，没有报警", () => {
    const v = concentrationVerdict(m({ top1: 18, top1Industry: "电子", top3: 48, hhi: 1200, industryCount: 9 }));
    expect(v.level).toBe("diversified");
    expect(v.alerts).toHaveLength(0);
  });

  it("未分类 ≥10% → 提示结论仅供参考", () => {
    const v = concentrationVerdict(m({ top1: 40, top1Industry: "电子", hhi: 2500, unclassifiedPct: 15 }));
    expect(v.alerts.join(" ")).toContain("未分类");
  });
});

describe("端到端：从持仓到结论", () => {
  it("电子 79万 + 少量其他（合计 87.8万）→ 占 90%，dangerous", () => {
    const slices = aggregateByValue([
      mk("888001", "电子", 790000, "半导体"),
      mk("888002", "国防军工", 45000, "军工电子Ⅱ"),
      mk("888003", "光伏", 20000, "光伏设备"),
      mk("888004", "医药生物", 15000, "医疗器械"),
      mk("888005", "计算机", 8000, "软件开发"),
    ]);
    const m = concentrationMetrics(slices);
    expect(m.top1).toBe(90);   // 79万 / 87.8万
    expect(m.hhi).toBeGreaterThan(2500);
    const v = concentrationVerdict(m);
    expect(v.level).toBe("dangerous");
  });
});
