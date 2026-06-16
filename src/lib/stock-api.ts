// ============================================================
// stock-api.ts — A 股数据获取模块
// ============================================================
// 职责：对接新浪/东方财富公开 API，获取行情和基本面数据。
// 所有网络请求由 Next.js API 路由代理，前端不直接调用外部 API。
//
// 注意：
// - WSL 环境通过 node-fetch + https-proxy-agent 走 Windows Clash 代理
// - 新浪财经返回 GBK 编码的中文，需通过东方财富（JSON/UTF-8）获取股票名称

import type { StockCode, StockQuote, StockFundamentals, StockData, InsiderTrade, IndexData } from "./types";
import { getSinaPrefix, getEastMoneySecId } from "./constants";
import { calcSafetyScore, calcFearGauge } from "./indicators";

// ─── 代理配置 ──────────────────────────────────────────────────

const PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "http://192.168.124.11:7890";

let _proxyAgent: any = null;
function getProxyAgent() {
  if (!_proxyAgent) {
    try {
      // 动态 import ESM 模块
      const mod = require("https-proxy-agent");
      _proxyAgent = new mod.HttpsProxyAgent(PROXY);
    } catch {
      _proxyAgent = undefined;
    }
  }
  return _proxyAgent;
}

/** 带代理的 fetch，回调中可直接用同步返回 */
// node-fetch v3 是 ESM only，这里用原生 fetch + 代理 agent
import fetch from "node-fetch";

function proxyFetch(url: string, init?: any): Promise<any> {
  return (fetch as any)(url, { ...init, agent: getProxyAgent() });
}

// ─── 新浪财经 API（实时行情）────────────────────────────────────

/** 解析新浪返回的 CSV 格式 */
function parseSinaResponse(text: string): Map<string, Partial<StockQuote>> {
  const map = new Map<string, Partial<StockQuote>>();

  // 新浪返回格式: var hq_str_sh600519="贵州茅台,1900.00,1895.00,...";
  const lines = text.split(";\n");
  lines.forEach((line: string) => {
    const match = line.match(/hq_str_(\w+)="(.+)"/);
    if (!match) return;
    const rawCode = match[1];
    const fields = match[2].split(",");
    if (fields.length < 32) return;

    const code = rawCode.replace(/^(sh|sz|bj)/, "");
    map.set(code, {
      code,
      name: fields[0],
      currentPrice: parseFloat(fields[3]) || 0,
      prevClose: parseFloat(fields[2]) || 0,
      changePercent: parseFloat(fields[2]) || 0,
      changeAmount: 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      volume: parseFloat(fields[8]) || 0,
      amount: parseFloat(fields[9]) || 0,
      timestamp: Date.now(),
    });
  });
  return map;
}

/** 构建新浪 URL */
export function buildSinaUrl(codes: StockCode[]): string {
  const prefix = codes.map((c) => `${getSinaPrefix(c)}${c}`).join(",");
  return `https://hq.sinajs.cn/list=${prefix}`;
}

/** 从新浪获取实时行情（服务端使用） */
export async function fetchSinaQuotes(
  codes: StockCode[]
): Promise<Map<string, StockQuote>> {
  const url = buildSinaUrl(codes);
  const res = await proxyFetch(url, {
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  // 新浪返回 GBK 编码，尝试用 GBK 解码
  let text: string;
  try {
    const buffer = await res.arrayBuffer();
    text = new TextDecoder("gbk").decode(buffer);
  } catch {
    text = await res.text();
  }

  const parsed = parseSinaResponse(text);
  const result = new Map<string, StockQuote>();

  parsed.forEach((partial, code) => {
    const prevClose = partial.prevClose ?? 0;
    const currentPrice = partial.currentPrice ?? 0;
    const changeAmount = currentPrice - prevClose;
    const changePercent = prevClose > 0
      ? parseFloat(((changeAmount / prevClose) * 100).toFixed(2))
      : 0;

    result.set(code, {
      code,
      name: partial.name ?? code,
      currentPrice,
      prevClose,
      changePercent,
      changeAmount: parseFloat(changeAmount.toFixed(2)),
      high: partial.high ?? 0,
      low: partial.low ?? 0,
      volume: partial.volume ?? 0,
      amount: partial.amount ?? 0,
      timestamp: Date.now(),
    });
  });

  return result;
}

// ─── 东方财富 API（基本面 + 股票名称）───────────────────────────

/** 东方财富 API 返回的原始数据项 */
interface EastMoneyItem {
  f12?: string;  // 代码
  f14?: string;  // 名称
  f20?: number;  // 总市值
  f21?: number;  // 动态市盈率
  f23?: number;  // 市净率
  f37?: number;  // 股息率
  f8?: number;   // 换手率
  f38?: number;  // 每股收益
  f39?: number;  // 每股净资产
}

/** 解析东方财富 JSONP 返回，提取基本面和名称 */
function parseEastMoneyResponse(
  json: any,
  codes: StockCode[]
): { fundamentals: Map<string, StockFundamentals>; names: Map<string, string> } {
  const fundamentals = new Map<string, StockFundamentals>();
  const names = new Map<string, string>();

  if (!json?.data?.diff) return { fundamentals, names };

  json.data.diff.forEach((item: EastMoneyItem) => {
    const code: string = item.f12 ?? "";
    if (!code || !codes.includes(code)) return;

    fundamentals.set(code, {
      pe: item.f21 ?? null,
      pb: item.f23 ?? null,
      marketCap: item.f20 != null
        ? parseFloat((item.f20 / 1e8).toFixed(2))
        : null,
      dividendYield: item.f37 ?? null,
      turnoverRate: item.f8 ?? null,
      eps: item.f38 ?? null,
      bvps: item.f39 ?? null,
    });

    if (item.f14) {
      names.set(code, item.f14);
    }
  });

  return { fundamentals, names };
}

/** 构建东方财富 API URL */
export function buildEastMoneyUrl(codes: StockCode[]): string {
  const secids = codes.map(getEastMoneySecId).join(",");
  // f2=最新价, f3=涨跌幅, f8=换手率, f12=代码, f14=名称,
  // f20=总市值, f21=动态市盈率, f23=市净率, f37=股息率,
  // f38=每股收益, f39=每股净资产
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f8,f12,f14,f20,f21,f23,f37,f38,f39&secids=${secids}`;
}

/** 从东方财富获取基本面和名称（服务端使用） */
export async function fetchEastMoneyFundamentals(
  codes: StockCode[]
): Promise<{ fundamentals: Map<string, StockFundamentals>; names: Map<string, string> }> {
  const url = buildEastMoneyUrl(codes);
  const res = await proxyFetch(url, {
    headers: {
      Referer: "https://quote.eastmoney.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  const json = await res.json();
  return parseEastMoneyResponse(json, codes);
}

// ─── 大盘指数 ───────────────────────────────────────────────────

/** 获取大盘指数数据（上证 + 创业板） */
export async function fetchIndexData(codes: StockCode[]): Promise<IndexData[]> {
  const quotesMap = await fetchSinaQuotes(codes);
  const result: IndexData[] = [];

  codes.forEach((code) => {
    const quote = quotesMap.get(code);
    if (!quote) return;

    // 指数默认值
    const fearGauge = calcFearGauge(
      quote.changePercent, quote.high, quote.low, quote.prevClose, null
    );

    result.push({
      quote: {
        code: quote.code,
        name: code === "000001" ? "上证指数" : code === "399006" ? "创业板指" : quote.name,
        currentPrice: quote.currentPrice,
        prevClose: quote.prevClose,
        changePercent: quote.changePercent,
        changeAmount: quote.changeAmount,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        amount: quote.amount,
        timestamp: quote.timestamp,
      },
      fearGauge,
    });
  });

  return result;
}

// ─── 高管增减持（预留）────────────────────────────────────────────

/** 获取最近高管增减持数据 */
export async function fetchInsiderTrades(code: StockCode): Promise<InsiderTrade[]> {
  // 东方财富数据中心
  const secuCode = (code.startsWith("6") ? "SH" : "SZ") + code;
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_EH_HOLDERNUMCHANGE&columns=SECUCODE,SECURITY_NAME_ABBR,CHANGE_DATE,HOLDER_NAME,HOLD_TYPE,CHANGE_NUM,CHANGE_AVG_PRICE,AFTER_HOLD_NUM&filter=(SECUCODE="${secuCode}")&pageNumber=1&pageSize=5&sortTypes=-1&sortColumns=CHANGE_DATE`;
  try {
    const res = await proxyFetch(url, {
      headers: { Referer: "https://data.eastmoney.com", "User-Agent": "Mozilla/5.0" },
    });
    const json = await res.json();
    const rows = json?.result?.data ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    return (rows.map((r: any) => {
      const changeNum = parseFloat(r.CHANGE_NUM) || 0;
      return {
        date: r.CHANGE_DATE ?? "",
        name: r.HOLDER_NAME ?? "",
        position: r.HOLD_TYPE ?? "",
        changeType: (changeNum > 0 ? "增持" : changeNum < 0 ? "减持" : "未知") as "增持" | "减持" | "未知",
        volume: Math.abs(changeNum),
        price: parseFloat(r.CHANGE_AVG_PRICE) || 0,
        ratio: 0,
      } satisfies InsiderTrade;
    }) as InsiderTrade[]).filter((t) => t.volume > 0);
  } catch {
    return [];
  }
}

// ─── 合并接口 ───────────────────────────────────────────────────

/** 获取完整的股票数据（行情 + 基本面 + 指标 + 增减持） */
export async function fetchFullStockData(codes: StockCode[]): Promise<StockData[]> {
  const [quotesMap, eastMoneyResult] = await Promise.all([
    fetchSinaQuotes(codes),
    fetchEastMoneyFundamentals(codes),
  ]);

  return codes
    .filter((code) => quotesMap.has(code))
    .map((code) => {
      const quote = quotesMap.get(code)!;
      const name = eastMoneyResult.names.get(code) || quote.name;
      const fundamentals = eastMoneyResult.fundamentals.get(code) ?? {
        pe: null, pb: null, marketCap: null, dividendYield: null,
        turnoverRate: null, eps: null, bvps: null,
      };

      const safetyScore = calcSafetyScore(
        quote.currentPrice, fundamentals.pe, fundamentals.pb
      );

      const fearGauge = calcFearGauge(
        quote.changePercent, quote.high, quote.low,
        quote.prevClose, fundamentals.turnoverRate
      );

      return {
        quote: { ...quote, name },
        fundamentals,
        safetyScore,
        fearGauge,
      };
    });
}
