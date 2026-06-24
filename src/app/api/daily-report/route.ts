// ============================================================
// src/app/api/daily-report/route.ts — 日报缓存接口
// ============================================================

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const reportPath = path.join(process.cwd(), "cache", "latest_report.md");
  try {
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf-8");
      const stats = fs.statSync(reportPath);
      return NextResponse.json({
        success: true,
        content,
        generatedAt: stats.mtime.toISOString(),
      });
    }
    return NextResponse.json({
      success: false,
      content: null,
      error: "暂无日报数据，请等待定时任务生成",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
