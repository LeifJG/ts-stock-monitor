// ============================================================
// src/app/api/alerts/sync/route.ts — 预警规则服务端持久化
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  try {
    ensureDir();
    const body = await request.json();
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    ensureDir();
    if (!fs.existsSync(ALERTS_FILE)) {
      return NextResponse.json({ success: true, data: [], settings: { pushToMobile: false } });
    }
    const raw = fs.readFileSync(ALERTS_FILE, "utf-8");
    return NextResponse.json({ success: true, ...JSON.parse(raw) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
