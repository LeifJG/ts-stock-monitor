// ============================================================
// tests/data-freshness.test.ts — 数据新鲜度判定
// ------------------------------------------------------------
// 背景：2026-11 出过"指数分位用了两年前数据、界面看不出来"的事故。
// 这张卡片的意义就是让"数据是什么时候的"变成可见信息，所以判定逻辑必须稳。
// ============================================================

import { describe, expect, it } from "vitest";
import {
  DATA_SOURCES,
  assessFreshness,
  cadenceLabel,
  formatAge,
  summarize,
  type FreshnessRow,
} from "@/lib/data-freshness";

const row = (status: FreshnessRow["status"]): FreshnessRow => ({
  key: "x",
  label: "x",
  path: "x.json",
  cadence: "daily",
  refresher: "test",
  maxAgeHours: 24,
  updatedAt: null,
  ageHours: null,
  status,
});

describe("assessFreshness", () => {
  it("周期内 ok", () => {
    expect(assessFreshness(1, 24)).toBe("ok");
    expect(assessFreshness(24, 24)).toBe("ok");
  });

  it("超过 1.2 倍算偏旧", () => {
    expect(assessFreshness(30, 24)).toBe("late");
  });

  it("超过 2 倍算过期", () => {
    expect(assessFreshness(49, 24)).toBe("stale");
  });

  it("没有文件算缺失", () => {
    expect(assessFreshness(null, 24)).toBe("missing");
    expect(assessFreshness(NaN, 24)).toBe("missing");
  });

  it("时钟偏差（负数）不误报", () => {
    expect(assessFreshness(-2, 24)).toBe("ok");
  });

  it("两年前的数据必须判过期（历史事故的回归测试）", () => {
    expect(assessFreshness(24 * 730, 36)).toBe("stale");
  });
});

describe("formatAge", () => {
  it("分钟/小时/天/月", () => {
    expect(formatAge(0.5 / 60)).toBe("刚刚");
    expect(formatAge(0.5)).toBe("30 分钟前");
    expect(formatAge(5)).toBe("5 小时前");
    expect(formatAge(72)).toBe("3 天前");
    expect(formatAge(24 * 75)).toBe("2 个月前");
  });

  it("无数据", () => {
    expect(formatAge(null)).toBe("无数据");
  });
});

describe("cadenceLabel", () => {
  it("中文标签", () => {
    expect(cadenceLabel("daily")).toBe("每日定时");
    expect(cadenceLabel("weekly")).toBe("每周定时");
    expect(cadenceLabel("monthly")).toBe("每月定时");
    expect(cadenceLabel("ondemand")).toBe("手动录入");
    expect(cadenceLabel("intraday")).toBe("实时/按需");
  });
});

describe("summarize", () => {
  it("全好就说全好", () => {
    const s = summarize([row("ok"), row("ok")]);
    expect(s.ok).toBe(2);
    expect(s.headline).toContain("均在刷新周期内");
  });

  it("有异常要数清楚", () => {
    const s = summarize([row("ok"), row("late"), row("stale"), row("missing")]);
    expect(s.stale).toBe(1);
    expect(s.late).toBe(1);
    expect(s.missing).toBe(1);
    expect(s.headline).toContain("3 项需要关注");
  });
});

describe("DATA_SOURCES 清单", () => {
  it("每项都必须声明刷新者与过期阈值（否则卡片会说不出'谁在更新'）", () => {
    for (const s of DATA_SOURCES) {
      expect(s.key, s.label).toBeTruthy();
      expect(s.refresher.length, s.key).toBeGreaterThan(4);
      expect(s.maxAgeHours, s.key).toBeGreaterThan(0);
      expect(s.path.endsWith(".json"), s.key).toBe(true);
    }
  });

  it("key 不重复", () => {
    const keys = DATA_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("已知的手动录入项不能标成自动刷新", () => {
    const cash = DATA_SOURCES.find((s) => s.key === "cash");
    expect(cash?.cadence).toBe("ondemand");
  });
});
