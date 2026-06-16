// ============================================================
// src/app/api/stocks/route.ts — A 股数据 API 路由
// ============================================================
// 前端通过此接口获取行情数据，不直接调用外部 API。
// 支持个股行情 + 大盘指数 + 高管增减持。

import { NextRequest, NextResponse } from "next/server";
import { fetchFullStockData, fetchIndexData, fetchInsiderTrades } from "@/lib/stock-api";
import type { ApiResponse, StockData, StockCode, IndexData, InsiderTrade } from "@/lib/types";

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

// ─── 新增：大盘指数 API ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type } = body;

    // 获取大盘指数
    if (type === "indices") {
      const indexCodes: StockCode[] = ["000001", "399006"];
      const data = await fetchIndexData(indexCodes);
      return NextResponse.json<ApiResponse<IndexData[]>>(
        { success: true, data },
        { status: 200 }
      );
    }

    // 获取高管增减持
    if (type === "insider") {
      const { code } = body;
      if (!code) {
        return NextResponse.json<ApiResponse<InsiderTrade[]>>(
          { success: false, error: "请提供股票代码" },
          { status: 400 }
        );
      }
      const data = await fetchInsiderTrades(code);
      return NextResponse.json<ApiResponse<InsiderTrade[]>>(
        { success: true, data },
        { status: 200 }
      );
    }

    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: "未知请求类型" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
