// ============================================================
// src/app/api/portfolio/sync/route.ts — 持仓数据持久化
// ============================================================
// 将前端 localStorage 的持仓数据同步到服务端 JSON 文件，
// 供收盘后的分析脚本和定时任务使用。

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  try {
    ensureDir();
    const body = await request.json();
    // 写入持仓数据
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    ensureDir();
    if (!fs.existsSync(PORTFOLIO_FILE)) {
      return NextResponse.json({ success: true, data: [] });
    }
    const raw = fs.readFileSync(PORTFOLIO_FILE, "utf-8");
    return NextResponse.json({ success: true, data: JSON.parse(raw) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
