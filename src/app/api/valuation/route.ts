// ============================================================
// src/app/api/valuation/route.ts — 估值分位 API
// ============================================================
// 从 data/valuation_cache.json 读取个股 PE/PB 历史分位数据。
// 支持 ?codes=600519,000858 过滤。

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const CACHE_PATH = path.join(process.cwd(), "data", "valuation_cache.json");

export interface ValuationData {
  code: string;
  price: number;
  pe_ttm: number;
  pb: number;
  pe_median_5y: number;
  pb_median_5y: number;
  updated_at: string;
  pe_pct_1y?: number;
  pe_pct_3y?: number;
  pe_pct_5y?: number;
  pb_pct_1y?: number;
  pb_pct_3y?: number;
  pb_pct_5y?: number;
  pe_min_5y: number;
  pe_max_5y: number;
  pb_min_5y: number;
  pb_max_5y: number;
  history?: { date: string; pe: number | null; pb: number | null }[];
}

// ── 估值缓存补抓（后台 fire-and-forget）────────────────────
const backfillPending = new Set<string>();
const MAX_BACKFILL_BATCH = 30;

function triggerBackfill(codes: string[]) {
  // 同一批 miss 可能被多个组件/多轮轮询同时发现，按码去重；
  // 正在抓的码跳过，全部都在抓的则不重复 spawn。
  const fresh = codes.filter((c) => !backfillPending.has(c));
  if (fresh.length === 0) return;
  fresh.slice(0, MAX_BACKFILL_BATCH).forEach((c) => backfillPending.add(c));

  const batch = fresh.slice(0, MAX_BACKFILL_BATCH);
  const python = path.join(process.cwd(), ".venv", "bin", "python3");
  const script = path.join(process.cwd(), "scripts", "valuation_data.py");
  const child = spawn(python, [script, ...batch], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: false,
  });
  child.on("exit", () => {
    batch.forEach((c) => backfillPending.delete(c));
  });
  child.on("error", () => {
    batch.forEach((c) => backfillPending.delete(c));
  });
  child.unref();
}

export async function GET(request: NextRequest) {
  try {
    let cache: Record<string, ValuationData> = {};
    try {
      const raw = await fs.readFile(CACHE_PATH, "utf-8");
      cache = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { success: false, error: "估值缓存不存在，请先运行 scripts/valuation_data.py" },
        { status: 404 }
      );
    }

    const codesParam = request.nextUrl.searchParams.get("codes");
    const all = Object.values(cache);
    const data = codesParam
      ? all.filter((v) => codesParam.split(",").map((c) => c.trim()).filter(Boolean).includes(v.code))
      : all;

    // ── 缓存 miss 自动补抓 ──────────────────────────────
    // 自选股（localStorage）服务端拿不到，定时抓取只覆盖研究池∪持仓。
    // 对请求中缓存缺失的代码，后台触发估值脚本补抓（防抖去重），
    // 抓写缓存后前端下次轮询自然拿到数据。
    if (codesParam) {
      const requested = codesParam.split(",").map((c) => c.trim()).filter(Boolean);
      const missing = requested.filter((c) => !cache[c]);
      if (missing.length > 0) {
        triggerBackfill(missing);
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
