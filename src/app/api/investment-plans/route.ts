// ============================================================
// src/app/api/investment-plans/route.ts — 定投计划 API
// ============================================================
// GET  /api/investment-plans           → 全部计划的今日建议
// GET  /api/investment-plans?check=1   → 数据源自检（ETF行情/指数日线）
// POST /api/investment-plans           → 更新计划配置（金额/频率/档位）
//
// 计算全部落在 scripts/investment_plans.py，这里只做 HTTP 包装。
// 为什么不在 TS 里算：均线和溢价率的取数逻辑（腾讯字段 [81]=净值、
// 新浪美股日线）已经在 Python 侧验证过，重复实现容易出现两套口径。

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const PLANS_FILE = path.join(DATA_DIR, "investment_plans.json");

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = searchParams.get("check") === "1";

  try {
    const args = check ? ["--check"] : [];
    const output = runPythonScript("investment_plans.py", args, { timeout: 120000 });
    return NextResponse.json(JSON.parse(output));
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message, plans: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.plans)) {
      return NextResponse.json(
        { success: false, error: "需要 { plans: [...] } 结构" },
        { status: 400 }
      );
    }

    // 保留 _说明 段：它是给人看的字段说明，前端提交时通常不带回来
    let doc: any = { plans: body.plans };
    if (fs.existsSync(PLANS_FILE)) {
      try {
        const old = JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
        if (old._说明) doc = { _说明: old._说明, plans: body.plans };
      } catch {
        /* 旧文件损坏就用新的 */
      }
    }
    fs.writeFileSync(PLANS_FILE, JSON.stringify(doc, null, 2), "utf-8");

    return NextResponse.json({ success: true, count: body.plans.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
