// ============================================================
// src/app/api/stocks/route.ts — A 股数据 API 路由
// ============================================================
// 前端通过此接口获取行情数据+大盘指数，不直接调用外部 API。

import { NextRequest, NextResponse } from "next/server";
import { fetchFullStockData } from "@/lib/stock-api";
import type { ApiResponse, StockData, StockCode } from "@/lib/types";

export const dynamic = "force-dynamic";

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

    const data = await fetchFullStockData(codes);

    return NextResponse.json<ApiResponse<StockData[]>>(
      { success: true, data },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json<ApiResponse<StockData[]>>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
