// ============================================================
// src/app/api/cash-bond/route.ts — 现金管理与股债性价比 API
// 数据源：
//   data/bond_cache.json        （scripts/bond_data.py 生成：国债收益率/逆回购/债券ETF）
//   cache/index_valuations.json （中证指数 PE 与 5 年分位，日报同源）
// 组合出「各指数的股票盈利收益率 vs 10 年国债」的 ERP 表。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { runPythonScript } from "@/lib/python-runner";
import { erp, earningsYield } from "@/lib/erp";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const BOND_CACHE = path.join(DATA_DIR, "bond_cache.json");
const INDEX_VAL = path.join(process.cwd(), "cache", "index_valuations.json");
const TTL_MS = 6 * 3600 * 1000;

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function bondCacheStale(): boolean {
  try {
    const d = JSON.parse(fs.readFileSync(BOND_CACHE, "utf-8"));
    const ts = new Date(d.generated_at).getTime();
    return !Number.isFinite(ts) || Date.now() - ts > TTL_MS;
  } catch {
    return true;
  }
}

export async function GET(_request: NextRequest) {
  try {
    // 缓存过期就同步跑一次脚本（首次约 5-10s，之后 6 小时内直接读文件）
    let refreshed = false;
    if (bondCacheStale()) {
      try {
        runPythonScript("bond_data.py", [], { timeout: 120000 });
        refreshed = true;
      } catch {
        // 抓取失败不阻断：下面仍返回旧缓存（若有）
      }
    }

    const bond = readJson<{
      generated_at?: string;
      yields?: Record<string, { value: number; pct_5y?: number; pct_10y?: number; date?: string; min_5y?: number; max_5y?: number }>;
      repo?: Record<string, { code: string; desc: string; rate: number }>;
      etfs?: Array<Record<string, unknown>>;
    }>(BOND_CACHE, {});

    const idx = readJson<{ generated_at?: number | string; indices?: Array<{ code: string; name: string; pe?: number; pct_5y?: number; etf?: string }> }>(
      INDEX_VAL, { indices: [] });

    const d10 = bond.yields?.d10?.value ?? null;

    // 股债性价比：每个指数一条
    const erpRows = (idx.indices ?? [])
      .filter((i) => i.pe != null && Number.isFinite(i.pe))
      .map((i) => ({
        code: i.code,
        name: i.name,
        etf: i.etf,
        pe: i.pe,
        earningsYield: earningsYield(i.pe),
        erp: erp(i.pe, d10),
        pePct5y: i.pct_5y ?? null,
      }))
      .sort((a, b) => (b.erp ?? -99) - (a.erp ?? -99));

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: bond.generated_at ?? null,
        refreshed,
        yields: bond.yields ?? {},
        repo: bond.repo ?? {},
        etfs: bond.etfs ?? [],
        bond10y: d10,
        erp: erpRows,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
