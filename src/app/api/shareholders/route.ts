// ============================================================
// src/app/api/shareholders/route.ts — 股东人数 API 路由
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const CACHE_FILE = path.join(process.cwd(), "data", "shareholder_cache.json");

interface ShareholderTrendData {
  code: string;
  latestHolders: number;
  latestChangePct: number;
  trend: Array<{
    date: string;
    holders: number;
    prevHolders: number | null;
    change: number | null;
    changePct: number;
    avgValue: number | null;
    avgShares: number | null;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return NextResponse.json(
        { success: false, error: "请提供 code 参数" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(CACHE_FILE)) {
      return NextResponse.json(
        { success: false, error: "股东数据未缓存，请先运行 scripts/shareholder_data.py" },
        { status: 404 }
      );
    }

    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const cache = JSON.parse(raw);
    const data = cache[code] as ShareholderTrendData | undefined;

    if (!data) {
      return NextResponse.json(
        { success: false, error: `未找到 ${code} 的股东数据` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
