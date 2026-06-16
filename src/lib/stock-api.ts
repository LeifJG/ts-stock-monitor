// ============================================================
// stock-api.ts — A 股数据获取模块
// ============================================================
// 职责：对接新浪/东方财富公开 API，获取行情、基本面、增减持等数据。
// 所有网络请求由 Next.js API 路由代理，前端不直接调用外部 API。

import type {
  StockCode, StockQuote, StockFundamentals, StockData,
  IndexQuote, IndexData, InsiderTrade
} from "./types";
import { getSinaPrefix, getEastMoneySecId } from "./constants";
import { calcSafetyScore, calcFearGauge } from "./indicators";

// ─── 新浪财经 API（实时行情）────────────────────────────────────

function parseSinaResponse(text: string): Map<string, Partial<StockQuote>> {
  const map = new Map<string, Partial<StockQuote>>();
  const lines = text.split(";\n");
  lines.forEach((line: string) => {
    const match = line.match(/hq_str_(\w+)="(.+)"/);
    if (!match) return;
    const rawCode = match[1];
    const fields = match[2].split(",");
    if (fields.length < 32) return;
    const code = rawCode.replace(/^(sh|sz|bj)/, "");
    map.set(code, {
      code, name: fields[0],
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

export function buildSinaUrl(codes: StockCode[]): string {
  const prefix = codes.map((c) => `${getSinaPrefix(c)}${c}`).join(",");
  return `https://hq.sinajs.cn/list=${prefix}`;
}

export async function fetchSinaQuotes(codes: StockCode[]): Promise<Map<string, StockQuote>> {
  const url = buildSinaUrl(codes);
  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" },
  });
  let text: string;
  try {
    const buffer = await res.arrayBuffer();
    text = new TextDecoder("gbk").decode(buffer);
  } catch { text = await res.text(); }
  const parsed = parseSinaResponse(text);
  const result = new Map<string, StockQuote>();
  parsed.forEach((partial, code) => {
    const prevClose = partial.prevClose ?? 0;
    const currentPrice = partial.currentPrice ?? 0;
    const changeAmount = currentPrice - prevClose;
    const changePercent = prevClose > 0
      ? parseFloat(((changeAmount / prevClose) * 100).toFixed(2)) : 0;
    result.set(code, { code, name: partial.name ?? code, currentPrice, prevClose, changePercent,
      changeAmount: parseFloat(changeAmount.toFixed(2)), high: partial.high ?? 0, low: partial.low ?? 0,
      volume: partial.volume ?? 0, amount: partial.amount ?? 0, timestamp: Date.now() });
  });
  return result;
}

// ─── 新浪指数 API ──────────────────────────────────────────────

/** 解析新浪指数返回（格式类似个股但字段少） */
function parseSinaIndexResponse(text: string): Map<string, Partial<IndexQuote>> {
  const map = new Map<string, Partial<IndexQuote>>();
  const lines = text.split(";\n");
  lines.forEach((line: string) => {
    const match = line.match(/hq_str_(\w+)="(.+)"/);
    if (!match) return;
    const rawCode = match[1];
    const fields = match[2].split(",");
    if (fields.length < 8) return;
    const code = rawCode.replace(/^(sh|sz|bj)/, "");
    map.set(code, {
      code, name: fields[0],
      currentPrice: parseFloat(fields[1]) || 0,
      changePercent: parseFloat(fields[3]) || 0,
      changeAmount: parseFloat(fields[2]) || 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      volume: parseFloat(fields[7]) || 0,
      amount: parseFloat(fields[8]) || 0,
    });
  });
  return map;
}

/** 从新浪获取大盘指数行情 */
export async function fetchIndexQuotes(codes: StockCode[]): Promise<Map<string, IndexQuote>> {
  const prefix = codes.map((c) => `${getExchange(c)}${c}`).join(",");
  const url = `https://hq.sinajs.cn/list=${prefix}`;
  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" },
  });
  let text: string;
  try {
    const buffer = await res.arrayBuffer();
    text = new TextDecoder("gbk").decode(buffer);
  } catch { text = await res.text(); }
  const parsed = parseSinaIndexResponse(text);
  const result = new Map<string, IndexQuote>();
  parsed.forEach((v, code) => {
    if (v.currentPrice && v.currentPrice > 0) result.set(code, v as IndexQuote);
  });
  return result;
}

/** 交易所前缀（给新浪用） */
function getExchange(code: string): string {
  if (code.startsWith("6") || code === "000001") return "sh";
  return "sz";
}

// ─── 东方财富 API（基本面 + 股票名称）───────────────────────────

interface EastMoneyItem {
  f12?: string; f14?: string; f20?: number; f21?: number;
  f23?: number; f37?: number; f8?: number; f38?: number; f39?: number;
}

function parseEastMoneyResponse(json: any, codes: StockCode[]) {
  const fundamentals = new Map<string, StockFundamentals>();
  const names = new Map<string, string>();
  if (!json?.data?.diff) return { fundamentals, names };
  json.data.diff.forEach((item: EastMoneyItem) => {
    const code: string = item.f12 ?? "";
    if (!code || !codes.includes(code)) return;
    fundamentals.set(code, {
      pe: item.f21 != null ? parseFloat(item.f21) : null,
      pb: item.f23 != null ? parseFloat(item.f23) : null,
      marketCap: item.f20 != null ? parseFloat((item.f20 / 1e8).toFixed(2)) : null,
      dividendYield: item.f37 != null ? parseFloat(item.f37.toFixed(2)) : null,
      turnoverRate: item.f8 ?? null,
      eps: item.f38 ?? null,
      bvps: item.f39 ?? null,
    });
    if (item.f14) names.set(code, item.f14);
  });
  return { fundamentals, names };
}

export function buildEastMoneyUrl(codes: StockCode[]): string {
  const secids = codes.map(getEastMoneySecId).join(",");
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f8,f12,f14,f20,f21,f23,f37,f38,f39&secids=${secids}`;
}

export async function fetchEastMoneyFundamentals(codes: StockCode[]) {
  const url = buildEastMoneyUrl(codes);
  const res = await fetch(url, {
    headers: { Referer: "https://quote.eastmoney.com", "User-Agent": "Mozilla/5.0" },
  });
  return parseEastMoneyResponse(await res.json(), codes);
}

// ─── 高管增减持 API（东方财富数据中心）─────────────────────────

export async function fetchInsiderTrades(code: StockCode): Promise<InsiderTrade[]> {
  const exchange = code.startsWith("6") ? "SH" : "SZ";
  const secuCode = `${code}.${exchange}`;
  // 东方财富数据中心接口
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_EH_HOLDERNUMCHANGE&columns=SECUCODE,SECURITY_NAME_ABBR,CHANGE_DATE,HOLDER_NAME,HOLD_TYPE,CHANGE_NUM,CHANGE_AVG_PRICE,AFTER_HOLD_NUM&filter=(SECUCODE="${secuCode}")&pageNumber=1&pageSize=5&sortTypes=-1&sortColumns=CHANGE_DATE`;
  try {
    const res = await fetch(url, {
      headers: { Referer: "https://data.eastmoney.com", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    const rows = json?.result?.data ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows.map((r: any) => {
      const changeNum = parseFloat(r.CHANGE_NUM) || 0;
      return {
        date: r.CHANGE_DATE ?? "",
        name: r.HOLDER_NAME ?? "",
        position: r.HOLDER_TYPE ?? "",
        changeType: changeNum > 0 ? "增持" : changeNum < 0 ? "减持" : "未知",
        volume: Math.abs(changeNum),
        price: parseFloat(r.CHANGE_AVG_PRICE) || 0,
        ratio: 0,
      };
    }).filter((t: InsiderTrade) => t.volume > 0);
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
      const safetyScore = calcSafetyScore(quote.currentPrice, fundamentals.pe, fundamentals.pb);
      const fearGauge = calcFearGauge(
        quote.changePercent, quote.high, quote.low, quote.prevClose, fundamentals.turnoverRate
      );
      return { quote: { ...quote, name }, fundamentals, safetyScore, fearGauge };
    });
}

/** 获取大盘指数行情 + 恐慌指数 */
export async function fetchIndexData(codes: StockCode[]): Promise<IndexData[]> {
  const quotes = await fetchIndexQuotes(codes);
  return codes
    .filter((code) => quotes.has(code))
    .map((code) => {
      const q = quotes.get(code)!;
      const fearGauge = calcFearGauge(q.changePercent, q.high, q.low, q.currentPrice - q.changeAmount, null);
      return { quote: q, fearGauge };
    });
}
