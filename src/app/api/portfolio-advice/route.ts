// ============================================================
// src/app/api/portfolio-advice/route.ts — 持仓操作建议 API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");
const CACHE_FILE = path.join(DATA_DIR, "advice_cache.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function runAnalysis(): any {
  ensureDir();

  if (!fs.existsSync(PORTFOLIO_FILE)) {
    return { success: true, advice: [], note: "暂无持仓数据" };
  }

  const scriptPath = path.join(process.cwd(), "scripts", "portfolio_advice.py");
  // 优先用 Hermes 虚拟环境的 Python（有 akshare + pandas）
  const pythonBin = (() => {
    const home = process.env.HOME || "/home/lijg";
    const venvPython = path.join(home, ".hermes", "hermes-agent", "venv", "bin", "python3");
    const fs = require("fs");
    if (fs.existsSync(venvPython)) return venvPython;
    return "python3";
  })();
  const env = {
    ...process.env,
    http_proxy: process.env.http_proxy || "http://192.168.124.11:7890",
    https_proxy: process.env.https_proxy || "http://192.168.124.11:7890",
    HTTP_PROXY: process.env.http_proxy || "http://192.168.124.11:7890",
    HTTPS_PROXY: process.env.https_proxy || "http://192.168.124.11:7890",
  };

  const output = execSync(
    `"${pythonBin}" "${scriptPath}" --portfolio "${PORTFOLIO_FILE}"`,
    { encoding: "utf-8", timeout: 30000, env }
  );

  return JSON.parse(output);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  // 缓存检查（盘中的分析可缓存 5 分钟，收盘后的可缓存 1 小时）
  if (!force) {
    try {
      ensureDir();
      if (fs.existsSync(CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        const age = Date.now() - cached.timestamp;
        if (age < 5 * 60 * 1000) {
          return NextResponse.json(cached.data);
        }
      }
    } catch {}
  }

  try {
    const result = runAnalysis();
    // 写缓存
    ensureDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      data: result,
    }), "utf-8");
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, advice: [], error: err.message },
      { status: 500 }
    );
  }
}
