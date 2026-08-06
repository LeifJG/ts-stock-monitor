// ============================================================
// src/app/api/insider/route.ts — 高管增减持 API（调用 Python akshare）
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";

// ─── 内存缓存（5 分钟过期） ──────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number;
}
let cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/**
 * 调用 Python 脚本获取高管增减持数据
 */
function fetchInsiderFromPython(codes: string[]): any {
  const codesStr = codes.join(",");
  const output = runPythonScript("fetch_insider.py", [codesStr], { timeout: 20000 });
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

  // 缓存 key: 排序后取前 10 个代码的 hash
  const cacheKey = [...codes].sort().slice(0, 10).join(",");
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
      { success: false, data: [], error: err.message },
      { status: 500 }
    );
  }
}
