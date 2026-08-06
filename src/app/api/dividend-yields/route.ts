// ============================================================
// src/app/api/dividend-yields/route.ts — 统一股息率 API
// ============================================================
// 数据来源：巨潮资讯网（cninfo）真实分红记录
// 所有前端组件通过此接口获取统一股息率数据
// 后端 Python 脚本通过 dividend_data.py 模块直接读取

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const CACHE_FILE = path.join(process.cwd(), "data", "dividend_yields.json");

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codesParam = searchParams.get("codes") || "";
  const force = searchParams.get("force") === "true";

  const codes = codesParam
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    // 检查缓存是否已存在
    const cacheExists = fs.existsSync(CACHE_FILE);

    if (codes.length === 0 && cacheExists && !force) {
      // 无指定代码且缓存存在 — 返回全部缓存
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      return NextResponse.json({ success: true, data: cached });
    }

    // 需要请求 Python 模块获取数据
    const args = [...codes];
    if (force) args.push("--refresh");
    const output = runPythonScript("dividend_data.py", args, { timeout: 60000 });
    const data = JSON.parse(output);

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    // 缓存兜底：尝试返回旧缓存数据
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        return NextResponse.json({
          success: true,
          data: cached,
          note: "使用的缓存数据（实时获取失败）",
        });
      }
    } catch {}

    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
