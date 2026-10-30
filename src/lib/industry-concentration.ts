// ============================================================
// src/lib/industry-concentration.ts — 持仓行业暴露与集中度（纯函数）
// ------------------------------------------------------------
// 为什么按**市值**而不是只数：10 只各占 3% 的票和 1 只占 30% 的票，
// 只数口径会算成一样的"分散"，但风险完全不同。行业暴露必须用市值加权。
//
// 两层口径：
//   l1  = 申万一级（电子/银行/食品饮料…），用于判断集中度
//   l2  = 东财细分（半导体/白酒/白色家电…），用于看清到底是什么生意
//
// HHI（赫芬达尔指数）= Σ(份额%)²，0–10000：
//   10000 = 单一行业 100%，<1500 分散，1500–2500 中度，>2500 高度集中
// ============================================================

export interface IndustryHolding {
  code: string;
  name?: string;
  /** 申万一级 */
  l1: string;
  /** 市值（人民币元） */
  value: number;
  /** 细分行业，可选 */
  l2?: string;
}

export interface IndustrySlice {
  industry: string;
  value: number;
  pct: number;
  count: number;
  codes: string[];
  /** 该行业的细分构成（按市值降序） */
  details: Array<{ name: string; l2: string; value: number; pct: number }>;
}

/** 按市值聚合到申万一级，占比 %，降序 */
export function aggregateByValue(items: IndustryHolding[]): IndustrySlice[] {
  const valid = items.filter((i) => Number.isFinite(i.value) && i.value > 0);
  const total = valid.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return [];

  type DetailAcc = { name: string; l2: string; value: number };
  type IndustryAcc = { value: number; codes: string[]; details: Map<string, DetailAcc> };
  const map = new Map<string, IndustryAcc>();
  for (const it of valid) {
    const key = it.l1 || "未分类";
    const e: IndustryAcc = map.get(key) ?? { value: 0, codes: [], details: new Map<string, DetailAcc>() };
    e.value += it.value;
    e.codes.push(it.code);
    // 同一只票可能分多笔持有（例如大小仓拆分）→ 明细按 code 合并，避免「09880、09880」
    const d: DetailAcc = e.details.get(it.code) ?? { name: it.name ?? it.code, l2: it.l2 ?? key, value: 0 };
    d.value += it.value;
    e.details.set(it.code, d);
    map.set(key, e);
  }

  return Array.from(map.entries())
    .map(([industry, e]) => ({
      industry,
      value: Math.round(e.value),
      pct: Math.round((e.value / total) * 1000) / 10,
      count: e.codes.length,
      codes: e.codes,
      details: Array.from(e.details.values())
        .map((d) => ({ ...d, pct: Math.round((d.value / total) * 1000) / 10 }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
}

/** 赫芬达尔指数：Σ(份额%)²，四舍五入到整数 */
export function hhi(pcts: number[]): number {
  const sum = pcts.reduce((s, p) => s + (Number.isFinite(p) ? p : 0) ** 2, 0);
  return Math.round(sum);
}

export interface ConcentrationMetrics {
  top1: number;
  top1Industry: string | null;
  top3: number;
  hhi: number;
  industryCount: number;
  /** 未分类市值占比（分类缺失时要提示结论仅供参考） */
  unclassifiedPct: number;
}

export function concentrationMetrics(slices: IndustrySlice[]): ConcentrationMetrics {
  const pcts = slices.map((s) => s.pct);
  const unclassified = slices.find((s) => s.industry === "未分类")?.pct ?? 0;
  return {
    top1: slices[0]?.pct ?? 0,
    top1Industry: slices[0]?.industry ?? null,
    top3: Math.round(pcts.slice(0, 3).reduce((s, p) => s + p, 0) * 10) / 10,
    hhi: hhi(pcts),
    industryCount: slices.length,
    unclassifiedPct: unclassified,
  };
}

export type ConcentrationLevel = "diversified" | "moderate" | "concentrated" | "dangerous";

export interface ConcentrationVerdict {
  level: ConcentrationLevel;
  label: string;
  headline: string;
  alerts: string[];
}

/**
 * 集中度判定（按申万一级）：
 *   单一行业 ≥50%       → dangerous（这一个行业决定你全部盈亏）
 *   单一行业 ≥30% 或 HHI≥2500 → concentrated
 *   HHI ≥1500           → moderate
 *   其余                 → diversified
 */
export function concentrationVerdict(m: ConcentrationMetrics): ConcentrationVerdict {
  const alerts: string[] = [];

  if (m.top1 >= 30 && m.top1Industry) {
    alerts.push(
      `「${m.top1Industry}」占 ${m.top1}%${m.top1 >= 50 ? "——单一行业过半，你的盈亏基本等于这一个行业" : "——单一行业超过 30% 警戒线"}`
    );
  }
  if (m.top3 >= 70) alerts.push(`前三大行业合计 ${m.top3}%，分散度不足，行业轮动会让你持续跑输或跑赢大盘`);
  if (m.hhi >= 2500) alerts.push(`HHI ${m.hhi}（>2500 为高度集中）`);
  else if (m.hhi >= 1500) alerts.push(`HHI ${m.hhi}（1500–2500 为中度集中）`);
  if (m.unclassifiedPct >= 10) alerts.push(`${m.unclassifiedPct}% 的市值行业未分类，结论仅供参考`);

  let level: ConcentrationLevel = "diversified";
  let label = "分散";
  if (m.top1 >= 50) {
    level = "dangerous";
    label = "高度集中";
  } else if (m.top1 >= 30 || m.hhi >= 2500) {
    level = "concentrated";
    label = "偏集中";
  } else if (m.hhi >= 1500) {
    level = "moderate";
    label = "中度分散";
  }

  const headline =
    m.top1Industry == null
      ? "还没有持仓数据"
      : `最大行业「${m.top1Industry}」占 ${m.top1}%｜前三大 ${m.top3}%｜HHI ${m.hhi}｜共 ${m.industryCount} 个行业`;

  return { level, label, headline, alerts };
}

/**
 * 申万一级之外的一个提醒：制造业 vs 非制造业的粗分。
 * 用途：避免把「半导体」和「美的」都当成"制造业配置"（见问题：科创50 算制造业吗）
 */
export const HK_INDUSTRIAL = new Set(["电子", "电力设备", "机械设备", "国防军工", "汽车", "基础化工"]);
