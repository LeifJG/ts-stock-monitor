// ============================================================
// src/app/api/stocks/route.ts — A 股数据 API 路由（带缓存）
// ============================================================
// 前端通过此接口获取行情数据+大盘指数，不直接调用外部 API。
//
// 缓存策略（2026-10 加）：上游腾讯行情 qt.gtimg.cn:443 的 TCP 建连
// 会间歇性卡 7 秒，导致每次刷新都转圈 5 秒+。这里加一层：
//   · 交易时段 TTL 20 秒（价格变化快，但不能每次等上游）
//   · 非交易时段 TTL 300 秒（收盘后价格不动，没必要反复拉）
//   · 陈旧期返回旧值 + 后台刷新，用户永远不用等
// 缓存按「排序后的 codes」做 key，前端换顺序也能命中。

import { NextRequest, NextResponse } from "next/server";
import { fetchFullStockData } from "@/lib/stock-api";
import { cachedPersistent, isTradingHours } from "@/lib/api-cache";
import type { ApiResponse, StockData, StockCode } from "@/lib/types";

export const dynamic = "force-dynamic";

// 交易时段 20 秒，非交易时段 5 分钟
const TTL_TRADING = 20_000;
const TTL_CLOSED = 300_000;

export async function GET(request: NextRequest) {
  try {
    const codesParam = request.nextUrl.searchParams.get("codes");
    if (!codesParam) {
      return NextResponse.json<ApiResponse<StockData[]>>(
        { success: false, error: "请提供 codes 参数，如 ?codes=600519,000858" },
        { status: 400 }
      );
    }

    const codes: StockCode[] = codesParam
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (codes.length === 0) {
      return NextResponse.json<ApiResponse<StockData[]>>(
        { success: false, error: "codes 参数为空" },
        { status: 400 }
      );
    }

    if (codes.length > 50) {
      return NextResponse.json<ApiResponse<StockData[]>>(
        { success: false, error: "单次最多查询 50 只股票" },
        { status: 400 }
      );
    }

    // key 用排序后的 codes：前端换个顺序也能命中同一份缓存
    const cacheKey = `stocks:${[...codes].sort().join(",")}`;
    const ttl = isTradingHours() ? TTL_TRADING : TTL_CLOSED;

    // 用 cachedPersistent：结果落盘到 cache/api/，服务重启后第一次请求
    // 也能直接读盘返回（否则要等上游 1.6s）
    const data = await cachedPersistent(cacheKey, () => fetchFullStockData(codes), {
      ttl,
    });

    return NextResponse.json<ApiResponse<StockData[]>>(
      { success: true, data },
      {
        status: 200,
        // 让浏览器也缓存一小会儿，减少重复请求
        headers: {
          "Cache-Control": `public, max-age=0, s-maxage=${Math.floor(ttl / 1000)}`,
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json<ApiResponse<StockData[]>>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
