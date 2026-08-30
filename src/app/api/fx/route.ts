// ============================================================
// src/app/api/fx/route.ts — 港币汇率接口（P1-5）
// 读取 scripts/fetch_fx_rate.py 抓取的中行牌价缓存
// ============================================================

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const FX_FILE = path.join(process.cwd(), "cache", "fx_rate.json");
const MAX_AGE_MS = 48 * 3600 * 1000; // 超过 48h 视为过期，客户端应回退默认值

export async function GET() {
  try {
    const raw = JSON.parse(fs.readFileSync(FX_FILE, "utf-8"));
    const age = Date.now() - new Date(raw.updated_at).getTime();
    return NextResponse.json({
      success: true,
      rate: raw.rate,
      source: raw.source,
      date: raw.date,
      updatedAt: raw.updated_at,
      stale: age > MAX_AGE_MS,
    });
  } catch {
    return NextResponse.json({ success: false, error: "汇率缓存不可用" }, { status: 404 });
  }
}
