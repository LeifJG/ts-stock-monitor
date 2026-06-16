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
  roe: number | null;          // 净资产收益率(%)
  bvps: number | null;         // 每股净资产(元)
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
      roe: fields[66] ? parseFloat(fields[66]) || null : null,
      bvps: fields[68] ? parseFloat(fields[68]) / 10 || null : null,
    });
  });

  return map;
}

/** 构建腾讯行情 URL */
function buildTencentUrl(codes: StockCode[]): string {
  const items = codes.map((c) => {
    // 上证指数特殊处理
    if (c === "000001") return `sh${c}`;
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

// ─── 东财财务数据（可选补充） ──────────────────────────────────────

interface EastMoneyFinData {
  dividendYield: number | null;  // 股息率(%)
  debtRatio: number | null;      // 资产负债率(%)
}

/**
 * 尝试从东方财富获取补充财务数据
 * 直连（不走代理），超时 4s，失败则返回空数据
 */
async function fetchFinancialsFromEastMoney(codes: StockCode[]): Promise<Map<string, EastMoneyFinData>> {
  const result = new Map<string, EastMoneyFinData>();

  await Promise.all(codes.map(async (code) => {
    // 确定 secid: 沪市=1.xxx, 深市=0.xxx
    const secid = code.startsWith("6") ? `1.${code}`
      : code.startsWith("0") || code.startsWith("3") ? `0.${code}`
      : `2.${code}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      // f162=股息率, f167=资产负债率, f168=ROE
      const res = await (fetch as any)(
        `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f162,f167`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (!res.ok) return;
      const json = await res.json();
      if (!json?.data) return;

      const raw162 = json.data.f162 as number | undefined;
      const raw167 = json.data.f167 as number | undefined;

      // f162: 每股股息(TTM) → 转成股息率(%)
      // 有些版本 f162 是股息率(千分比), 需校验
      // 优先用 raw162 * 0.001 作为股息率, 再用 PE 交叉验证
      let divYield: number | null = null;
      if (raw162 != null && raw162 > 0) {
        // 保守估计: 股息率 = raw162 / 1000 (%)
        divYield = Math.round(raw162 / 10) / 100; // 千分比转百分比
        // 如果算出来 > 20%, 说明不是这个含义
        if (divYield > 20) divYield = null;
      }

      // f167: 资产负债率 (百分比的千分比?)
      let debtRatio: number | null = null;
      if (raw167 != null && raw167 > 0) {
        debtRatio = Math.round(raw167 / 10) / 10; // 千分比转百分比
        if (debtRatio > 100) debtRatio = null;
      }

      result.set(code, { dividendYield: divYield, debtRatio });
    } catch {
      // 静默失败
    }
  }));

  return result;
}

// ─── 合并接口 ───────────────────────────────────────────────────

/** 获取完整的股票数据（行情 + 基本面 + 指标） */
export async function fetchFullStockData(codes: StockCode[]): Promise<StockData[]> {
  // 并行发起：腾讯行情 + 东财补充数据
  const [tencentData, emFinPromise] = await Promise.all([
    fetchFromTencent(codes),
    fetchFinancialsFromEastMoney(codes),
  ]);

  const results = codes
    .filter((code) => tencentData.has(code))
    .map((code) => {
      const d = tencentData.get(code)!;
      const em = emFinPromise.get(code);

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

      // BVPS = 价 / PB（优先用PB计算，腾讯直给作为备选）
      const bvpsCalc = d.pb != null && d.pb > 0
        ? Math.round((d.currentPrice / d.pb) * 100) / 100
        : null;
      const bvps = bvpsCalc ?? d.bvps;

      // ROE = PB / PE（杜邦分析最简形式）
      let roe: number | null = null;
      if (d.pb != null && d.pe != null && d.pe > 0) {
        const calcRoe = (d.pb / d.pe) * 100;
        if (calcRoe < 100) roe = Math.round(calcRoe * 100) / 100;
      }
      // 腾讯直给的 ROE 作为备选
      if (roe == null) roe = d.roe;

      // EPS = 价 / PE
      const eps = d.pe != null && d.pe > 0
        ? Math.round((d.currentPrice / d.pe) * 1000) / 1000
        : null;

      // 股息率：优先东财
      const divYield = em?.dividendYield ?? null;

      // 股息支付率 = 每股股息 / EPS
      let dividendPayoutRatio: number | null = null;
      if (divYield != null && eps != null && eps > 0) {
        const divPerShare = (divYield / 100) * d.currentPrice;
        dividendPayoutRatio = Math.round((divPerShare / eps) * 100 * 100) / 100;
        if (dividendPayoutRatio > 500) dividendPayoutRatio = null;
      }

      const fundamentals: StockFundamentals = {
        pe: d.pe,
        pb: d.pb,
        marketCap: d.marketCap,
        dividendYield: divYield,
        turnoverRate: d.turnoverRate,
        eps,
        bvps,
        roe,
        dividendPayoutRatio,
        debtRatio: em?.debtRatio ?? null,
      };

      const safetyScore = calcSafetyScore(
        d.currentPrice, d.pe, d.pb
      );

      const fearGauge = calcFearGauge(
        d.changePercent, d.high, d.low, d.prevClose, d.turnoverRate
      );

      return {
        quote,
        fundamentals,
        safetyScore,
        fearGauge,
      };
    });

  return results;
}
