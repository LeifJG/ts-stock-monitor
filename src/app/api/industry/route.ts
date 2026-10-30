// ============================================================
// src/app/api/industry/route.ts — 行业分类 API（申万一级 + 细分）
// ------------------------------------------------------------
// 数据层：scripts/industry_data.py（落盘 data/industry_cache.json，TTL 90 天）
// 返回：[{ code, name, industry(细分), l1(申万一级) }]
//
// 修掉原实现两个问题：
//   1) 内存缓存 key 只取「前 10 个 code」——自选池一换（57 只 vs 8 只持仓）
//      就会串数据，前端拿到的是别的股票集合的行业分类
//   2) 只有细分行业（白酒/半导体设备），没有申万一级，
//      导致"消费电子 + 半导体 + 元件"没法归并成"电子"来算集中度
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";
import * as crypto from "crypto";

interface CacheEntry {
  data: unknown;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 真正的长缓存落在 python 的磁盘文件里

function cacheKeyOf(codes: string[]): string {
  const normalized = [...codes].map((c) => c.trim().toUpperCase()).sort().join(",");
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get("codes") || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const key = cacheKeyOf(codes);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL) {
    return NextResponse.json(hit.data);
  }

  try {
    // runPythonScript 返回的是 stdout 字符串，必须自己 parse
    const raw = runPythonScript("industry_data.py", [codes.join(",")], { timeout: 120000 });
    const result = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      success?: boolean;
      data?: Array<{ code: string; name?: string; industry?: string; l1?: string }>;
      error?: string;
    };
    if (!result?.success) {
      return NextResponse.json(
        { success: false, data: [], error: result?.error ?? "行业数据获取失败" },
        { status: 500 }
      );
    }
    const data = (result.data ?? []).map((r) => ({
      code: r.code,
      name: r.name ?? r.code,
      industry: r.industry ?? "未分类",   // 细分（东财口径）
      l1: r.l1 ?? "未分类",               // 申万一级
    }));
    const payload = { success: true, data };
    cache.set(key, { data: payload, timestamp: Date.now() });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Industry API error:", (err as Error).message);
    return NextResponse.json(
      { success: false, data: [], error: (err as Error).message },
      { status: 500 }
    );
  }
}
