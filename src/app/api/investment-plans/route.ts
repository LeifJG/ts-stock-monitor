// ============================================================
// src/app/api/investment-plans/route.ts — 定投计划 API
// ============================================================
// GET  /api/investment-plans            → 全部计划的今日建议（30 分钟缓存）
// GET  /api/investment-plans?force=1    → 跳过缓存强制重算
// GET  /api/investment-plans?check=1    → 数据源自检（ETF行情/指数日线，不缓存）
// POST /api/investment-plans            → 更新计划配置（写完自动清缓存）
//
// 计算全部落在 scripts/investment_plans.py，这里只做 HTTP 包装。
// 为什么不在 TS 里算：均线和溢价率的取数逻辑（腾讯字段 [81]=净值、
// 新浪美股日线）已经在 Python 侧验证过，重复实现容易出现两套口径。
//
// ── 缓存（30 分钟）───────────────────────────────────────────
// 一次计算要跑 Python 取纳指日线 + ETF 行情，实测首次 20-30 秒，
// 每次打开面板都等这么久没意义。缓存到 cache/investment_plans_result.json，
// 落文件而不是只放内存 —— 服务重启后缓存还在。
//
// 铁律：**跨天必须失效**。isDueToday / nextDueDate / 今日建议全部基于「今天」，
// 隔天沿用昨天结果会出现「今天是不是定投日」判断错误，这比慢更严重。
// 所以校验两个条件：① 未满 30 分钟 ② 生成日期 = 今天（按本地时区，不能用 toISOString 的 UTC）。

import { NextRequest, NextResponse } from "next/server";
import { runPythonScript } from "@/lib/python-runner";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const PLANS_FILE = path.join(DATA_DIR, "investment_plans.json");
const CACHE_FILE = path.join(process.cwd(), "cache", "investment_plans_result.json");
const CACHE_TTL_MS = 30 * 60 * 1000; // 半小时

/** 本地时区的 YYYY-MM-DD（toISOString 是 UTC，晚上 8 点后会跨天） */
function localDateStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readCache(): { data: any; ageMs: number; fresh: boolean } | null {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    const builtAt = Number(raw?._builtAt) || 0;
    const ageMs = Date.now() - builtAt;
    const sameDay = raw?._builtDate === localDateStr();
    return { data: raw, ageMs, fresh: ageMs >= 0 && ageMs < CACHE_TTL_MS && sameDay };
  } catch {
    return null; // 缓存文件损坏就当没有
  }
}

function clearCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    /* 删不掉不影响正确性，下次靠跨天/TTL 失效 */
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = searchParams.get("check") === "1";
  const force = searchParams.get("force") === "1";

  try {
    // 自检永远现算，不走缓存（它就是用来验数据源是否活着的）
    if (check) {
      const output = runPythonScript("investment_plans.py", ["--check"], { timeout: 120000 });
      return NextResponse.json(JSON.parse(output));
    }

    if (!force) {
      const hit = readCache();
      if (hit?.fresh) {
        const { _builtAt, _builtDate, ...rest } = hit.data;
        return NextResponse.json({
          ...rest,
          cached: true,
          cacheAgeSec: Math.round(hit.ageMs / 1000),
        });
      }
    }

    const output = runPythonScript("investment_plans.py", [], { timeout: 120000 });
    const data = JSON.parse(output);

    // 落盘时带上元信息，供下次判断新鲜度；返回给前端时剥掉
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify({ ...data, _builtAt: Date.now(), _builtDate: localDateStr() }),
        "utf-8"
      );
    } catch {
      /* 写不了缓存不影响本次返回 */
    }

    return NextResponse.json({ ...data, cached: false, cacheAgeSec: 0 });
  } catch (err: any) {
    // 算失败时若还有旧缓存，宁可给旧数据 + 标注，也不要直接报错让面板空掉
    const stale = readCache();
    if (stale) {
      const { _builtAt, _builtDate, ...rest } = stale.data;
      return NextResponse.json({
        ...rest,
        cached: true,
        stale: true,
        cacheAgeSec: Math.round(stale.ageMs / 1000),
        warning: `重算失败（${err.message}），这是 ${Math.round(stale.ageMs / 60000)} 分钟前的旧数据`,
      });
    }
    return NextResponse.json(
      { success: false, error: err.message, plans: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.plans)) {
      return NextResponse.json(
        { success: false, error: "需要 { plans: [...] } 结构" },
        { status: 400 }
      );
    }

    // 保留 _说明 段：它是给人看的字段说明，前端提交时通常不带回来
    let doc: any = { plans: body.plans };
    if (fs.existsSync(PLANS_FILE)) {
      try {
        const old = JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
        if (old._说明) doc = { _说明: old._说明, plans: body.plans };
      } catch {
        /* 旧文件损坏就用新的 */
      }
    }
    fs.writeFileSync(PLANS_FILE, JSON.stringify(doc, null, 2), "utf-8");

    // 配置改了，旧结果立刻作废 —— 否则改完金额 30 分钟内看到的还是旧数字
    clearCache();

    return NextResponse.json({ success: true, count: body.plans.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
