// ============================================================
// src/app/api/valuation/route.ts — 估值分位 API
// ============================================================
// 从 data/valuation_cache.json 读取个股 PE/PB 历史分位数据。
// 支持 ?codes=600519,000858 过滤。

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

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

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
