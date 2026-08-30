// ============================================================
// src/app/api/daily-report/route.ts — 收盘日报接口
// ------------------------------------------------------------
// GET  : 读取缓存报告；若缺失或已过期（交易日 15:05 后无当日报告）
//        则自动重新生成 —— 兜底机制，页面打开即自愈
// POST : 强制重新生成（systemd timer 收盘后调用 / 手动刷新）
// ============================================================

import { NextResponse } from "next/server";
import { generateDailyReport, isReportFresh } from "@/lib/daily-report";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 生成需拉取全部持仓实时行情

export async function GET() {
  try {
    const { content, generatedAt } = await generateDailyReport(false);
    return NextResponse.json({ success: true, content, generatedAt });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "日报生成失败" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const { content, generatedAt } = await generateDailyReport(true);
    return NextResponse.json({ success: true, content, generatedAt, forced: true });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "日报生成失败" },
      { status: 500 }
    );
  }
}

// 供监控/健康检查用：报告是否已覆盖今日收盘
export async function HEAD() {
  return new Response(null, { status: isReportFresh() ? 200 : 409 });
}
