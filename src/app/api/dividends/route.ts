// ============================================================
// src/app/api/dividends/route.ts — 历史分红数据 API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";

// 内存缓存（30 分钟过期，历史分红数据不常变）
interface CacheEntry {
  data: any;
  timestamp: number;
}
let cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 30 * 60 * 1000;

function fetchDividendsFromPython(codes: string[]): any {
  const codesStr = codes.join(",");
  const output = runPythonScript("fetch_dividend_history.py", [codesStr], { timeout: 60000 });
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
    return NextResponse.json({ success: true, data: [] });
  }

  // 缓存 key
  const cacheKey = [...codes].sort().slice(0, 10).join(",");
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const result = fetchDividendsFromPython(codes);
    cache[cacheKey] = { data: result, timestamp: Date.now() };
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Dividend API error:", err.message);
    return NextResponse.json(
      { success: false, data: [], error: err.message },
      { status: 500 }
    );
  }
}
