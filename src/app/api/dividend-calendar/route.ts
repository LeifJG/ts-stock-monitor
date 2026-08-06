// ============================================================
// src/app/api/dividend-calendar/route.ts — 分红日历 API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";

// 内存缓存（12 小时）
interface CacheEntry {
  data: any;
  timestamp: number;
}
let cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 12 * 60 * 60 * 1000;

function fetchCalendarFromPython(codes: string[]): any {
  const codesStr = codes.join(",");
  const output = runPythonScript("fetch_dividend_calendar.py", [codesStr], { timeout: 120000 });
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

  const cacheKey = [...codes].sort().slice(0, 10).join(",");
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const result = fetchCalendarFromPython(codes);
    cache[cacheKey] = { data: result, timestamp: Date.now() };
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Dividend Calendar API error:", err.message);
    return NextResponse.json(
      { success: false, data: [], error: err.message },
      { status: 500 }
    );
  }
}
