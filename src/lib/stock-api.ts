// ============================================================
// stock-api.ts — A 股数据获取模块
// ============================================================
// 数据源：腾讯财经 API（qt.gtimg.cn）— 实时行情 + 基本面，单接口搞定
// 所有请求通过代理（WSL → Windows Clash）转发

import type { StockCode, StockQuote, StockFundamentals, StockData, IndexData } from "./types";
import { calcSafetyScore, calcFearGauge } from "./indicators";

// ─── 代理配置 ──────────────────────────────────────────────────

const PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "http://192.168.124.11:7890";

let _proxyAgent: any = null;
function getProxyAgent() {
  if (!_proxyAgent) {
    try {
      const mod = require("https-proxy-agent");
      _proxyAgent = new mod.HttpsProxyAgent(PROXY);
    } catch {
      _proxyAgent = undefined;
    }
  }
  return _proxyAgent;
}

import fetch from "node-fetch";

async function proxyFetch(url: string, init?: any, retries = 2): Promise<any> {
  const agent = getProxyAgent();
  const opts = { ...init, agent };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await (fetch as any)(url, opts);
    } catch (err: any) {
      if (attempt === retries) throw err;
      if (err?.message?.includes("ENOTFOUND") || err?.message?.includes("ETIMEDOUT")) {
        // DNS 失败可能是代理路由问题，等 1s 重试
        await new Promise((r) => setTimeout(r, 1000));
      } else if (err?.message?.includes("hang up") || err?.message?.includes("ECONNRESET")) {
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        throw err; // 非网络错误不重试
      }
    }
  }
}

// ─── 腾讯财经 API ──────────────────────────────────────────────

/**
 * 腾讯股票 API 字段映射（qt.gtimg.cn）
 *
 * 返回格式：v_sh600519="...~...~..."
 * fields[0]  = 市场 (1=沪, 0=深)
 * fields[1]  = 名称
 * fields[2]  = 代码
 * fields[3]  = 当前价
 * fields[4]  = 昨收
 * fields[5]  = 今开
 * fields[6]  = 成交量(手)
 * fields[7]  = 买一量
 * fields[8]  = 买一价
 * ...
 * fields[29] = 市盈率
 * fields[30] = 振幅(%)
 * fields[31] = 流通市值
 * fields[32] = 总市值
 * fields[33] = 市净率
 * fields[34] = 涨停价
 * fields[35] = 跌停价
 * fields[36] = 最高
 * fields[37] = 最低
 * fields[38] = 每手股数
 * fields[39] = 总量(手)
 * fields[40] = 总额(元)
 * fields[41] = 换手率
 * fields[42] = 量比
 * ...
 * 共 ~49 个字段
 */

interface TencentStockData {
  name: string;
  code: string;
  currentPrice: number;
  prevClose: number;
  open: number;
  volume: number;       // 手
  amount: number;       // 成交额(元)
  high: number;
  low: number;
  changePercent: number;
  changeAmount: number;
  pe: number | null;
  pb: number | null;
  turnoverRate: number | null;
  marketCap: number | null;    // 总市值(亿)
  amplitude: number | null;
}

/** 解析腾讯返回的 GBK 格式（88 个字段） */
function parseTencentResponse(text: string): Map<string, TencentStockData> {
  const map = new Map<string, TencentStockData>();

  const lines = text.split("\n");
  lines.forEach((line) => {
    const match = line.match(/v_(\w+)="(.+)"/);
    if (!match) return;
    const fields = match[2].split("~");
    if (fields.length < 47) return;

    const code = match[1].replace(/^(sh|sz)/, "");
    const currentPrice = parseFloat(fields[3]) || 0;
    const prevClose = parseFloat(fields[4]) || 0;
    const changeAmount = currentPrice - prevClose;
    const changePercent = prevClose > 0
      ? parseFloat(((changeAmount / prevClose) * 100).toFixed(2))
      : 0;

    // amount 在腾讯 API 中是 "万" 单位，转成元
    const amountWan = parseFloat(fields[37]) || 0;
    const amount = amountWan * 10000;

    map.set(code, {
      name: fields[1] || code,
      code,
      currentPrice,
      prevClose,
      open: parseFloat(fields[5]) || 0,
      volume: parseFloat(fields[36]) || parseFloat(fields[6]) || 0,
      amount,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      changePercent,
      changeAmount: parseFloat(changeAmount.toFixed(2)),
      pe: fields[39] ? parseFloat(fields[39]) || null : null,
      pb: fields[46] ? parseFloat(fields[46]) || null : null,
      turnoverRate: fields[38] ? parseFloat(fields[38]) || null : null,
      marketCap: fields[45] ? parseFloat(fields[45]) || null : null,
      amplitude: fields[43] ? parseFloat(fields[43]) || null : null,
    });
  });

  return map;
}

/** 构建腾讯行情 URL */
function buildTencentUrl(codes: StockCode[]): string {
  // 腾讯格式: sh600519,sz000001
  const items = codes.map((c) => {
    const market = c.startsWith("6") ? "sh" : c.startsWith("0") || c.startsWith("3") ? "sz" : "bj";
    return `${market}${c}`;
  });
  return `https://qt.gtimg.cn/q=${items.join(",")}`;
}

// ─── 主力数据接口 ──────────────────────────────────────────────

/** 从腾讯获取完整股票数据（行情 + 基本面） */
async function fetchFromTencent(codes: StockCode[]): Promise<Map<string, TencentStockData>> {
  const url = buildTencentUrl(codes);
  const res = await proxyFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  // 腾讯返回 GBK 编码
  let text: string;
  try {
    const buffer = await res.arrayBuffer();
    text = new TextDecoder("gbk").decode(buffer);
  } catch {
    text = await res.text();
  }

  return parseTencentResponse(text);
}

// ─── 大盘指数 ───────────────────────────────────────────────────

/** 获取大盘指数数据（上证 + 创业板） */
export async function fetchIndexData(): Promise<IndexData[]> {
  // 上证指数 000001 = sh000001, 创业板指 399006 = sz399006
  const indexMap = await fetchFromTencent(["000001", "399006"]);

  return ["000001", "399006"]
    .map((code) => {
      const d = indexMap.get(code);
      if (!d) return null;

      const quote = {
        code,
        name: code === "000001" ? "上证指数" : "创业板指",
        currentPrice: d.currentPrice,
        prevClose: d.prevClose,
        changePercent: d.changePercent,
        changeAmount: d.changeAmount,
        high: d.high,
        low: d.low,
        volume: d.volume,
        amount: d.amount,
        timestamp: Date.now(),
      };

      const fearGauge = calcFearGauge(
        d.changePercent, d.high, d.low, d.prevClose, null
      );

      return { quote, fearGauge };
    })
    .filter(Boolean) as IndexData[];
}

// ─── 合并接口 ───────────────────────────────────────────────────

/** 获取完整的股票数据（行情 + 基本面 + 指标） */
export async function fetchFullStockData(codes: StockCode[]): Promise<StockData[]> {
  const tencentData = await fetchFromTencent(codes);

  return codes
    .filter((code) => tencentData.has(code))
    .map((code) => {
      const d = tencentData.get(code)!;

      const quote: StockQuote = {
        code: d.code,
        name: d.name,
        currentPrice: d.currentPrice,
        prevClose: d.prevClose,
        changePercent: d.changePercent,
        changeAmount: d.changeAmount,
        high: d.high,
        low: d.low,
        volume: d.volume,
        amount: d.amount,
        timestamp: Date.now(),
      };

      const fundamentals: StockFundamentals = {
        pe: d.pe,
        pb: d.pb,
        marketCap: d.marketCap,
        dividendYield: null,  // 腾讯不提供股息率
        turnoverRate: d.turnoverRate,
        eps: null,
        bvps: null,
      };

      // 用 PB 反向估算 BVPS（用当前价 ÷ PB）
      const bvps = d.pb != null && d.pb > 0
        ? Math.round((d.currentPrice / d.pb) * 100) / 100
        : null;

      const safetyScore = calcSafetyScore(
        d.currentPrice, d.pe, d.pb
      );

      const fearGauge = calcFearGauge(
        d.changePercent, d.high, d.low, d.prevClose, d.turnoverRate
      );

      return {
        quote,
        fundamentals: { ...fundamentals, bvps },
        safetyScore,
        fearGauge,
      };
    });
}
