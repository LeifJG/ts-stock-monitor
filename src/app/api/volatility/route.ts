// ============================================================
// src/app/api/volatility/route.ts — 真实历史波动率（网格步长依据）
// ------------------------------------------------------------
// GET: 读 data/volatility_cache.json（当日有效直接返回），
//      缺失/过期则调用 fetch_volatility.py 现算（akshare 日K）。
// 步长 = clamp(20日σ × 2, 2, 8)，由 Python 端计算。
// ============================================================

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { runPythonScriptAsync } from "@/lib/python-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CACHE_FILE = path.join(process.cwd(), "data", "volatility_cache.json");

export interface VolatilityItem {
  sigma: number;  // 20日日波动率(%)
  step: number;   // 建议网格步长(%)
  days: number;   // 参与计算的样本数
}

interface VolatilityCache {
  generated_at: number;
  success: boolean;
  ok: number;
  total: number;
  items: Record<string, VolatilityItem>;
}

/** 缓存是否为今天（北京时间）生成 */
function isCacheToday(cache: VolatilityCache | null): boolean {
  if (!cache || !cache.generated_at) return false;
  const bj = new Date(cache.generated_at + 8 * 3600 * 1000);
  const todayBj = new Date(Date.now() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10) === todayBj.toISOString().slice(0, 10);
}

function readCache(): VolatilityCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function generate(): Promise<VolatilityCache | null> {
  await runPythonScriptAsync("fetch_volatility.py", [], { timeout: 240_000 });
  return readCache();
}

export async function GET() {
  try {
    let cache = readCache();
    if (!isCacheToday(cache)) {
      cache = await generate();
    }
    if (!cache) {
      return NextResponse.json(
        { success: false, error: "波动率数据生成失败" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      generatedAt: cache.generated_at,
      ok: cache.ok,
      total: cache.total,
      data: cache.items,
    });
  } catch (err: any) {
    // 生成失败时返回过期缓存兜底（比没有好）
    const stale = readCache();
    if (stale) {
      return NextResponse.json({
        success: true,
        generatedAt: stale.generated_at,
        stale: true,
        data: stale.items,
      });
    }
    return NextResponse.json(
      { success: false, error: err?.message || "波动率生成失败" },
      { status: 500 }
    );
  }
}
