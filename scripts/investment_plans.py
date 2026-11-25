#!/usr/bin/env python3
"""
investment_plans.py — 指数/ETF 定投计划引擎

为什么需要：
    定投最容易犯的错是「到日子就买」，不看贵不贵、不看溢价。
    纳指 ETF 尤其危险：QDII 额度紧张时场内溢价能到 10-20%，
    到日子无脑买等于先亏一成。本模块把「该不该买、买多少」算出来。

策略（均线偏离 + 溢价过滤 + 金字塔加码）：
    1. 均线偏离：现价 vs 250 日均线，偏离越多投越多
         -10% 以上 → 2.0 份
         -5% 以上  → 1.5 份
         其他      → 1.0 份
    2. 溢价过滤（场内必查）：溢价率 > premiumMax 时本次不买
         溢价 = 场内市价 / 基金单位净值 - 1
         数据：腾讯行情字段 [3]=市价、[81]=净值（已与天天基金/新浪交叉验证一致）
    3. 金字塔加码：当月跌幅 ≥ goldenDrop% 时额外加 1 份

为什么不用估值分位做主策略：
    纳指 100 的 PE 长期在 25-40 之间，且成分股十年换过一轮（思科→苹果→英伟达），
    十年前的分位对现在没有参考价值。均线偏离识别的是「这段时间在不在跌」，
    对宽基指数比绝对估值可靠。

用法：
    python3 scripts/investment_plans.py                # 跑全部计划，输出今日建议
    python3 scripts/investment_plans.py --plan ndx     # 只跑指定计划
    python3 scripts/investment_plans.py --check        # 只检查数据源可达性
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PLANS_FILE = BASE / "data" / "investment_plans.json"

# ── 本脚本禁用代理直连（腾讯行情/东财均为国内站，走代理反而 DNS 失败）──
for _k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(_k, None)

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ============================================================
# 数据获取
# ============================================================

def fetch_etf_quote(code: str) -> dict | None:
    """场内 ETF 行情：市价 + 单位净值 → 溢价率

    腾讯行情 88 个字段里：
        [3]  最新价
        [4]  昨收
        [81] 单位净值（与天天基金 api.fund.eastmoney.com 的 DWJZ、
             新浪 hq.sinajs.cn 的 fu_ 接口三处一致，已验证）
    返回 None 表示取数失败，调用方必须显式处理，不能拿 0 或默认值糊过去。
    """
    prefix = "sh" if code.startswith(("5", "6")) else "sz"
    url = f"https://qt.gtimg.cn/q={prefix}{code}"
    last_err = None
    for attempt in range(3):
        try:
            raw = _OPENER.open(url, timeout=10).read().decode("gbk", "ignore")
            fields = raw.split('"')[1].split("~")
            if len(fields) < 82:
                return None
            price = float(fields[3]) if fields[3] else None
            prev_close = float(fields[4]) if fields[4] else None
            nav = float(fields[81]) if len(fields) > 81 and fields[81] else None
            if not price or not nav or nav <= 0:
                return None
            return {
                "code": code,
                "name": fields[1],
                "price": round(price, 4),
                "prevClose": round(prev_close, 4) if prev_close else None,
                "nav": round(nav, 4),
                "premiumPct": round((price / nav - 1) * 100, 2),
                "asOf": datetime.now().strftime("%Y-%m-%d %H:%M"),
            }
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    print(f"[warn] ETF {code} 行情获取失败: {last_err}", file=sys.stderr)
    return None


CACHE_DIR = BASE / "cache"


def fetch_index_daily(index_code: str, days: int = 400, max_age_hours: float = 12) -> list[dict] | None:
    """指数日线（新浪美股 / A股走东财），带本地缓存。

    为什么要缓存：新浪/东财的 DNS 会间歇性抖动（实测同一分钟内一次成功一次失败），
    而「今天投不投」的结论必须在同一份数据上得出——两个计划各抓一次，
    会出现「一个说均线缺失、一个说偏离 -4.89%」的自相矛盾。
    缓存还能让多个计划共用一次请求。

    index_code 形如 ".NDX"（纳斯达克100）、".IXIC"（纳指综指）、"000300"（沪深300）
    返回 [{date, close}, ...] 升序；取不到返回 None。
    """
    cache_file = CACHE_DIR / f"index_daily_{index_code.lstrip('.').replace('.', '_')}.json"

    def _read_cache(max_age_h: float):
        if not cache_file.exists():
            return None
        try:
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            age_h = (time.time() - cached.get("_fetchedAt", 0)) / 3600
            if age_h <= max_age_h and cached.get("rows"):
                return cached["rows"]
        except Exception:
            pass
        return None

    # 新鲜缓存直接用
    fresh = _read_cache(max_age_hours)
    if fresh:
        return fresh

    try:
        import akshare as ak
    except ImportError:
        print("[warn] 未安装 akshare，无法取指数日线", file=sys.stderr)
        return None

    df = None
    last_err = None
    for attempt in range(3):
        try:
            if index_code.startswith("."):
                df = ak.index_us_stock_sina(symbol=index_code)
            else:
                df = ak.stock_zh_index_daily(symbol=("sh" if index_code.startswith("0") else "sz") + index_code)
            break
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    if df is None or getattr(df, "empty", True):
        stale = _read_cache(24 * 30)     # 30 天内的旧缓存兜底
        if stale:
            print(f"[warn] 指数 {index_code} 实时取数失败，回退 {len(stale)} 行旧缓存: {last_err}",
                  file=sys.stderr)
            return stale
        print(f"[warn] 指数 {index_code} 日线获取失败且无可用缓存: {last_err}", file=sys.stderr)
        return None

    rows = []
    for _, r in df.tail(days).iterrows():
        try:
            d = r["date"]
            d = d if isinstance(d, date) else datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
            rows.append({"date": d.isoformat(), "close": float(r["close"])})
        except Exception:
            continue
    if rows:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(
                {"_fetchedAt": time.time(), "code": index_code, "rows": rows},
                ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    return rows or None


def compute_ma(rows: list[dict], window: int) -> float | None:
    """简单移动平均。样本不足 window 的 80% 时返回 None（样本不足不硬算）"""
    if not rows:
        return None
    closes = [r["close"] for r in rows[-window:]]
    if len(closes) < window * 0.8:
        return None
    return sum(closes) / len(closes)


# ============================================================
# 策略引擎
# ============================================================

DEFAULT_TIERS = [
    {"deviationLte": -10.0, "multiplier": 2.0, "label": "低于均线 10% 以上，加倍投"},
    {"deviationLte": -5.0, "multiplier": 1.5, "label": "低于均线 5% 以上，加投 50%"},
    {"deviationLte": 5.0, "multiplier": 1.0, "label": "均线附近，常规投"},
    {"deviationLte": 999.0, "multiplier": 0.5, "label": "高于均线 5% 以上，减半投"},
]


def pick_multiplier(deviation_pct: float, tiers: list[dict]) -> tuple[float, str]:
    """按均线偏离选档位。deviation = (现价/MA - 1)*100，负数=低于均线"""
    for t in sorted(tiers, key=lambda x: x["deviationLte"]):
        if deviation_pct <= t["deviationLte"]:
            return float(t["multiplier"]), t.get("label", "")
    return 1.0, ""


def next_due_date(plan: dict, today: date) -> date | None:
    """下次定投日（含今天）。日报里用户最想知道「下次哪天动手」。"""
    freq = plan.get("frequency", "monthly")
    try:
        if freq == "monthly":
            target_day = int(plan.get("dayOfMonth", 1))
            for y, m in ((today.year, today.month), *(
                (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1),)):
                last = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
                cand = date(y, m, min(target_day, last))
                if cand >= today:
                    return cand
            return None
        if freq in ("weekly", "biweekly"):
            target_wd = int(plan.get("dayOfWeek", 1))
            start = plan.get("startDate")
            start_d = datetime.strptime(start, "%Y-%m-%d").date() if start else None
            for i in range(0, 29):
                cand = today + timedelta(days=i)
                if cand.weekday() != target_wd:
                    continue
                if freq == "weekly":
                    return cand
                if start_d and int((cand - start_d).days / 7) % 2 == 0:
                    return cand
            return None
    except Exception:
        return None
    return None


def is_due_today(plan: dict, today: date) -> tuple[bool, str]:
    """今天是否定投日"""
    freq = plan.get("frequency", "monthly")
    if freq == "monthly":
        target_day = int(plan.get("dayOfMonth", 1))
        # 月末兜底：设 31 号但当月只有 30 天时，按当月最后一天触发
        last_day = (date(today.year + (today.month == 12), (today.month % 12) + 1, 1) - timedelta(days=1)).day
        if today.day == min(target_day, last_day):
            return True, f"每月 {target_day} 日"
        return False, f"每月 {target_day} 日"
    if freq == "weekly":
        target_wd = int(plan.get("dayOfWeek", 1))
        return (today.weekday() == target_wd), f"每周{'一二三四五六日'[target_wd]}"
    if freq == "biweekly":
        target_wd = int(plan.get("dayOfWeek", 1))
        start = plan.get("startDate")
        if not start:
            return (today.weekday() == target_wd), "每两周（缺 startDate，退化为每周判断）"
        try:
            start_d = datetime.strptime(start, "%Y-%m-%d").date()
        except Exception:
            return (today.weekday() == target_wd), "每两周（startDate 格式错）"
        weeks = (today - start_d).days / 7
        return (today.weekday() == target_wd and int(weeks) % 2 == 0), "每两周"
    return False, f"未知频率 {freq}"


def evaluate_plan(plan: dict, today: date | None = None,
                  index_rows: list[dict] | None = None) -> dict:
    """产出一个计划的今日建议（纯计算 + 取数，不写文件）"""
    today = today or date.today()
    base_amount = float(plan.get("baseAmount", 0))
    strategy = plan.get("strategy") or {}
    tiers = strategy.get("tiers") or DEFAULT_TIERS
    premium_max = float(strategy.get("premiumMax", 2.0))
    ma_window = int(strategy.get("maWindow", 250))
    mode = plan.get("mode", "onsite")     # onsite 场内 / otc 场外

    due, freq_txt = is_due_today(plan, today)

    # ── 均线偏离 ──
    idx_code = plan.get("proxyIndex")
    ma = None
    deviation = None
    last_close = None
    if index_rows is None and idx_code:
        index_rows = fetch_index_daily(idx_code, days=max(ma_window + 30, 300))
    if index_rows:
        last_close = index_rows[-1]["close"]
        ma = compute_ma(index_rows, ma_window)
        if ma:
            deviation = (last_close / ma - 1) * 100

    # ── 溢价率（仅场内）──
    quote = None
    premium = None
    premium_block = False
    if mode == "onsite" and plan.get("target"):
        quote = fetch_etf_quote(plan["target"])
        if quote:
            premium = quote["premiumPct"]
            premium_block = premium > premium_max

    # ── 金字塔加码（当月跌幅）──
    golden = strategy.get("goldenDrop") or {}
    month_drop = None
    extra_mult = 0.0
    if index_rows:
        month_ago = today - timedelta(days=30)
        prior = [r for r in index_rows if r["date"] <= month_ago.isoformat()]
        if prior and last_close:
            month_drop = (last_close / prior[-1]["close"] - 1) * 100
            if month_drop <= -float(golden.get("monthlyDrop", 15)):
                extra_mult = float(golden.get("extraMultiplier", 1.0))

    # ── 汇总 ──
    mult, tier_label = (pick_multiplier(deviation, tiers) if deviation is not None else (1.0, "均线数据缺失"))
    total_mult = mult + extra_mult
    amount = round(base_amount * total_mult)

    blockers = []
    if premium_block:
        blockers.append(f"溢价率 {premium:.2f}% 超过上限 {premium_max}%")
    if deviation is None:
        blockers.append("均线数据缺失，无法判断贵贱")

    if not due:
        action = "wait"
        headline = f"非定投日（{freq_txt}）"
    elif blockers:
        action = "skip"
        headline = "今天不买：" + "；".join(blockers)
    else:
        action = "buy"
        headline = f"建议投 {total_mult:.1f} 份 = ¥{amount:,}"

    reasons = []
    if deviation is not None and ma:
        reasons.append(f"指数 {last_close:.2f} / {ma_window}日均线 {ma:.2f} → 偏离 {deviation:+.2f}%（{tier_label}）")
    if premium is not None:
        reasons.append(f"溢价率 {premium:+.2f}%（上限 {premium_max}%，{'超标' if premium_block else '正常'}）")
    elif mode == "otc":
        reasons.append("场外按净值申购，无溢价问题；注意申购限额与暂停申购公告")
    if month_drop is not None:
        reasons.append(f"近 30 日指数 {month_drop:+.2f}%" + (f"，触发加码 +{extra_mult:.0f} 份" if extra_mult else ""))
    if quote:
        reasons.append(f"{quote['name']} 现价 {quote['price']} / 净值 {quote['nav']}")

    return {
        "planId": plan.get("id"),
        "name": plan.get("name"),
        "mode": mode,
        "target": plan.get("target"),
        "proxyIndex": idx_code,
        "isDueToday": due,
        "nextDueDate": (next_due_date(plan, today) or date.min).isoformat()
                       if next_due_date(plan, today) else None,
        "frequency": freq_txt,
        "action": action,               # buy / skip / wait
        "headline": headline,
        "amount": amount if action == "buy" else 0,
        "baseAmount": base_amount,
        "multiplier": round(total_mult, 2),
        "indexClose": round(last_close, 2) if last_close else None,
        "ma": round(ma, 2) if ma else None,
        "deviationPct": round(deviation, 2) if deviation is not None else None,
        "premiumPct": premium,
        "premiumMax": premium_max,
        "monthDropPct": round(month_drop, 2) if month_drop is not None else None,
        "reasons": reasons,
        "asOf": today.isoformat(),
    }


# ============================================================
# 计划读写
# ============================================================

def load_plans() -> list[dict]:
    if not PLANS_FILE.exists():
        return []
    try:
        raw = json.loads(PLANS_FILE.read_text(encoding="utf-8"))
        return raw.get("plans", []) if isinstance(raw, dict) else raw
    except Exception as e:
        print(f"[warn] {PLANS_FILE} 解析失败: {e}", file=sys.stderr)
        return []


def run_all(only: str | None = None) -> dict:
    plans = load_plans()
    if only:
        plans = [p for p in plans if p.get("id") == only]
    # 指数日线统一取一次：多个计划共用，既省请求也避免「各抓各的、结果不一致」
    index_cache: dict[str, list[dict] | None] = {}
    for p in plans:
        code = p.get("proxyIndex")
        if code and code not in index_cache:
            index_cache[code] = fetch_index_daily(code, days=int((p.get("strategy") or {}).get("maWindow", 250)) + 60)
    results = [evaluate_plan(p, index_rows=index_cache.get(p.get("proxyIndex")))
               for p in plans if p.get("enabled", True)]
    return {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(results),
        "plans": results,
    }


def check_sources() -> dict:
    """数据源可达性自检"""
    out = {}
    out["etf_quote_513100"] = fetch_etf_quote("513100")
    rows = fetch_index_daily(".NDX", days=300)
    out["index_ndx"] = {
        "rows": len(rows) if rows else 0,
        "lastDate": rows[-1]["date"] if rows else None,
        "lastClose": rows[-1]["close"] if rows else None,
        "ma250": compute_ma(rows, 250) if rows else None,
    }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", help="只跑指定计划 id")
    ap.add_argument("--check", action="store_true", help="只做数据源自检")
    args = ap.parse_args()

    if args.check:
        print(json.dumps(check_sources(), ensure_ascii=False, indent=2))
        return 0

    result = run_all(args.plan)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
