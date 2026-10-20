// ============================================================
// src/app/api/moat/route.ts — 护城河分析 API
// 数据源：data/moat_cache.json（量化层）+ data/moat_llm_cache.json（叙述层）
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const MOAT_CACHE = path.join(DATA_DIR, "moat_cache.json");
const LLM_CACHE = path.join(DATA_DIR, "moat_llm_cache.json");

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codesParam = searchParams.get("codes");
  const codes = codesParam
    ? codesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : null;

  try {
    const moatAll = fs.existsSync(MOAT_CACHE)
      ? JSON.parse(fs.readFileSync(MOAT_CACHE, "utf-8"))
      : {};
    const llmAll = fs.existsSync(LLM_CACHE)
      ? JSON.parse(fs.readFileSync(LLM_CACHE, "utf-8"))
      : {};

    let data: Record<string, unknown> = moatAll;
    if (codes) {
      data = {};
      for (const c of codes) {
        if (moatAll[c]) data[c] = moatAll[c];
      }
    }

    // 合并叙述层（如有）
    const merged: Record<string, unknown> = {};
    for (const [code, moat] of Object.entries(data as Record<string, object>)) {
      const llm = llmAll[code];
      merged[code] = llm ? { ...moat, narrative: llm } : moat;
    }

    return NextResponse.json({ success: true, data: merged });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
