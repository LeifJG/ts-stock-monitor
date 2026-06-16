// ============================================================
// src/app/api/industry/route.ts — 行业分类数据 API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import * as path from "path";

// 内存缓存（7 天，行业分类不常变）
interface CacheEntry {
  data: any;
  timestamp: number;
}
let cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function fetchIndustryFromPython(codes: string[]): any {
  const scriptPath = path.join(process.cwd(), "scripts", "fetch_industry.py");
  const codesStr = codes.join(",");

  const env = {
    ...process.env,
    http_proxy: process.env.http_proxy || "http://192.168.124.11:7890",
    https_proxy: process.env.https_proxy || "http://192.168.124.11:7890",
    HTTP_PROXY: process.env.http_proxy || "http://192.168.124.11:7890",
    HTTPS_PROXY: process.env.https_proxy || "http://192.168.124.11:7890",
  };

  const output = execSync(`python3 "${scriptPath}" "${codesStr}"`, {
    encoding: "utf-8",
    timeout: 30000,
    env,
  });

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
    const result = fetchIndustryFromPython(codes);
    cache[cacheKey] = { data: result, timestamp: Date.now() };
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Industry API error:", err.message);
    return NextResponse.json(
      { success: false, data: [], error: err.message },
      { status: 500 }
    );
  }
}
