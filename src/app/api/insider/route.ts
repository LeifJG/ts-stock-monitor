// ============================================================
// src/app/api/insider/route.ts — 高管增减持 + 港股回购 API
// ============================================================
// 后端 scripts/fetch_insider.py（Python akshare + 东财 报表）
//   - A股增减持：东财 stock_ggcg_em（当日 /tmp pickle 缓存）
//   - 港股回购：东财 RPT_HK_BUYBACK
// 内存缓存 30 分钟（增减持/回购都是公告级低频数据）

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";

interface CacheEntry {
  data: any;
  timestamp: number;
}
let cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

const PY_TIMEOUT = 220000; // A股全量快照首次拉取约 1.7 分钟 + 余量

function fetchInsiderFromPython(codes: string[]): any {
  const codesStr = codes.join(",");
  const output = runPythonScript("fetch_insider.py", [codesStr], { timeout: PY_TIMEOUT });
  return JSON.parse(output);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codesParam = searchParams.get("codes") || "";
  const codes = codesParam
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json({ success: true, data: { insiders: {}, buybacks: {} } });
  }

  const cacheKey = [...codes].sort().join(",");
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const result = fetchInsiderFromPython(codes);
    cache[cacheKey] = { data: result, timestamp: Date.now() };
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Insider API error:", err.message);
    return NextResponse.json(
      { success: false, data: { insiders: {}, buybacks: {} }, error: err.message },
      { status: 500 }
    );
  }
}
