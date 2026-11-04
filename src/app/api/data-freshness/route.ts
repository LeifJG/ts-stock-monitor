// ============================================================
// src/app/api/data-freshness/route.ts — 数据更新状态（页面"上次更新"统一口径）
//
// 为什么不只看文件 mtime：指数估值的 mtime 是"抓取时间"，真实数据日期在
// JSON 里的 data_date 字段（历史事故：mtime 每天在变，数据其实是两年前的）。
// 所以：优先取文件内部声明的数据日期，没有才退回 mtime。
//
// GET → { success, data: { updatedAt, rows[], summary } }
// ============================================================

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  DATA_SOURCES,
  assessFreshness,
  summarize,
  type FreshnessRow,
} from "@/lib/data-freshness";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();

/** 从 JSON 内部读真实数据日期（支持常见字段名），读不到返回 null */
function readInnerDataDate(fullPath: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    const candidates = [
      raw.data_date, // 指数估值：数据最后交易日
      raw.date,
      raw.updated_at,
      raw.updatedAt,
      raw.generated_at && typeof raw.generated_at === "string" ? raw.generated_at : null,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  const rows: FreshnessRow[] = DATA_SOURCES.map((spec) => {
    const full = path.join(ROOT, spec.path);
    let mtimeMs: number | null = null;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch {
      mtimeMs = null;
    }

    const ageHours =
      mtimeMs == null ? null : (now - mtimeMs) / 3_600_000;
    const updatedAt =
      mtimeMs == null ? null : new Date(mtimeMs).toISOString();

    return {
      ...spec,
      updatedAt,
      ageHours,
      status: assessFreshness(ageHours, spec.maxAgeHours),
      dataDate: mtimeMs == null ? null : readInnerDataDate(full),
    };
  });

  const summary = summarize(rows);

  return NextResponse.json({
    success: true,
    data: {
      updatedAt: new Date().toISOString(),
      // 定时任务的周期（与 systemd 保持一致，改定时器要同步改这里与 DATA_SOURCES）
      schedule: [
        { label: "每日 15:05（交易日）", detail: "汇率 / 波动率 / 指数估值分位 / 个股估值 / 财务 / 日报" },
        { label: "每周一 08:10", detail: "股息率 / 恐慌技术指标 / 股东户数 / 护城河量化 / 港股回购" },
        { label: "每月 1 日 08:20", detail: "护城河文字描述 / 行业分类全量刷新" },
        { label: "打开页面时", detail: "国债收益率与逆回购（缓存 6 小时）、操作建议（缓存 5 分钟）" },
      ],
      rows,
      summary,
    },
  });
}
