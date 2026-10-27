// ============================================================
// src/app/api/cash/route.ts — 可用现金（仓位分析用）
// 存储：data/cash.json（服务端，跟持仓一样不依赖浏览器 localStorage，
//       避免清缓存/换浏览器后现金数据丢失导致仓位分析失真）
// GET  → { success, data: { amount, updatedAt, note } }
// POST { amount, note? } → 覆盖写入
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const CASH_FILE = path.join(process.cwd(), "data", "cash.json");

function readCash(): { amount: number; updatedAt: string | null; note: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(CASH_FILE, "utf-8"));
    const amount = Number(raw?.amount);
    return {
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
      note: typeof raw?.note === "string" ? raw.note : "",
    };
  } catch {
    return { amount: 0, updatedAt: null, note: "" };
  }
}

export async function GET() {
  return NextResponse.json({ success: true, data: readCash() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ success: false, error: "amount 必须是非负数字" }, { status: 400 });
    }
    const data = {
      amount: Math.round(amount * 100) / 100,
      updatedAt: new Date().toISOString(),
      note: typeof body?.note === "string" ? body.note : "",
    };
    fs.mkdirSync(path.dirname(CASH_FILE), { recursive: true });
    fs.writeFileSync(CASH_FILE, JSON.stringify(data, null, 2), "utf-8");
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
