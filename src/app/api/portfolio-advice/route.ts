// ============================================================
// src/app/api/portfolio-advice/route.ts — 持仓操作建议 API
// ============================================================
// 性能说明（2026-10 优化）：
//   计算跑 portfolio_advice.py 要 ~700ms-1s，原来缓存过期时第一个请求
//   就得干等这段。改成「陈旧返回 + 后台刷新」：
//     · 缓存 5 分钟内 → 直接返回
//     · 超过 5 分钟但未超 6 小时 → 立刻返回旧建议，后台异步重算
//     · 只有从没算过（无缓存）时才同步等
//   建议本身是给收盘后决策用的，滞后几分钟没有实质影响。

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");
const CACHE_FILE = path.join(DATA_DIR, "advice_cache.json");

/** 新鲜期：5 分钟内直接返回 */
const FRESH_MS = 5 * 60 * 1000;
/** 陈旧期：这段时间内返回旧数据并后台刷新；超过则同步重算 */
const STALE_MS = 6 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function runAnalysis(): any {
  ensureDir();

  if (!fs.existsSync(PORTFOLIO_FILE)) {
    return { success: true, advice: [], note: "暂无持仓数据" };
  }

  const output = runPythonScript(
    "portfolio_advice.py",
    ["--portfolio", PORTFOLIO_FILE],
    { timeout: 30000 }
  );

  return JSON.parse(output);
}

/** 重算并落盘（后台刷新也走这里） */
function recomputeAndPersist(): any {
  const result = runAnalysis();
  ensureDir();
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ timestamp: Date.now(), data: result }),
    "utf-8"
  );
  return result;
}

// 进程内标记，避免后台刷新被并发触发多次
let refreshing = false;

function refreshInBackground() {
  if (refreshing) return;
  refreshing = true;
  setTimeout(() => {
    try {
      recomputeAndPersist();
    } catch {
      // 后台刷新失败就继续用旧数据，不打扰用户
    } finally {
      refreshing = false;
    }
  }, 0);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  if (!force) {
    try {
      ensureDir();
      if (fs.existsSync(CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        const age = Date.now() - (cached.timestamp ?? 0);
        // 新鲜期：直接给
        if (age < FRESH_MS) {
          return NextResponse.json(cached.data, {
            headers: { "X-Advice-Cache": "fresh" },
          });
        }
        // 陈旧期：先给旧的，后台刷新
        if (age < STALE_MS) {
          refreshInBackground();
          return NextResponse.json(cached.data, {
            headers: { "X-Advice-Cache": "stale-refreshing" },
          });
        }
      }
    } catch {
      // 缓存损坏就当没有，走下面的同步重算
    }
  }

  try {
    const result = recomputeAndPersist();
    return NextResponse.json(result, {
      headers: { "X-Advice-Cache": "miss" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, advice: [], error: err.message },
      { status: 500 }
    );
  }
}
