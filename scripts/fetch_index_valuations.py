#!/usr/bin/env python3
"""
fetch_index_valuations.py — 获取主要指数估值数据并缓存
输出: cache/index_valuations.json（含 PE 5 年分位 + 数据日期 + 新鲜度）

数据源：
  - 中证指数 perf 接口（沪市/中证系指数），必须显式传 start_date/end_date
  - 乐咕乐股 index-basic-pe（深证指数，如 399006 创业板指）

两条铁律（都是踩过坑换来的）：
  1. 不准硬编码"参考 PE / 参考分位"——抓不到就标 missing，假数字比没数字更危险
  2. cache 必须记录 data_date（数据最后交易日），前端/日报展示它而不是抓取时间
"""

import json, os, sys, time
from datetime import datetime, timedelta, date
import logging as log

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from net_utils import setup_proxy_env  # noqa: E402

setup_proxy_env()  # 网络不稳/需代理时自动探测，否则直连

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "cache", "index_valuations.json")
CACHE_FILE = os.path.abspath(CACHE_FILE)

# 要监控的核心指数
TARGET_INDICES = [
    {"code": "000300", "name": "沪深300",     "desc": "大盘蓝筹", "etf": "510300"},
    {"code": "000016", "name": "上证50",      "desc": "超大盘",   "etf": "510050"},
    {"code": "000905", "name": "中证500",     "desc": "中盘成长", "etf": "510500"},
    {"code": "000922", "name": "中证红利",    "desc": "高股息",   "etf": "515080"},
    {"code": "000852", "name": "中证1000",    "desc": "小盘",     "etf": "159845"},
    {"code": "399006", "name": "创业板指",    "desc": "科技成长", "etf": "159915"},
    {"code": "931009", "name": "红利低波100", "desc": "低波红利", "etf": "562850"},
    {"code": "000688", "name": "科创50",      "desc": "硬科技",   "etf": "588000"},
]

# 已知的参考数据（在 CSIndex 不可用时的后备）
# 注意：这里**故意不保留**硬编码的"参考 PE / 参考分位"。
# 历史事故：抓取失败时用写死的 PE 12.5 / 分位 35% 顶上，页面上看不出区别，
# 而真实值是 PE 13.1 / 分位 68% —— 假数字比没有数字危险得多。
# 抓取失败时一律 status="missing" / pe=None / pct=None，由前端与日报显示"数据缺失"。



def fetch_pe_data(code: str, years: int = 5) -> list[dict] | None:
    """从 CSIndex 获取历史 PE 数据。

    ⚠️ 必须显式传 start_date / end_date：akshare 的 stock_zh_index_hist_csindex
    默认 end_date="20240604"（写死在库里），不传就永远只到 2024-06-04。
    2026-11 实测过：这导致市场温度表 / 指数分位 / 现金仓位建议整整用了两年半前的数据，
    科创50 显示 PE 31.5 / 分位 30%，真实是 PE 50.5 / 分位 63%。
    """
    import time
    import akshare as ak
    import pandas as pd

    today = datetime.now()
    start_date = (today - pd.DateOffset(years=years)).strftime("%Y%m%d")
    end_date = today.strftime("%Y%m%d")

    df = None
    last_err: Exception | None = None
    for attempt in range(5):
        try:
            df = ak.stock_zh_index_hist_csindex(symbol=code, start_date=start_date, end_date=end_date)
            break
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    try:
        if df is None or df.empty:
            if last_err:
                log.warning(f"  {code} fetch failed after 5 attempts: {last_err}")
            return None
        if "滚动市盈率" not in df.columns or "日期" not in df.columns:
            return None
        # 只保留近5年
        df["日期"] = pd.to_datetime(df["日期"])
        cutoff = pd.Timestamp.now() - pd.DateOffset(years=5)
        df = df[df["日期"] >= cutoff]
        records = []
        for _, r in df.iterrows():
            pe = r["滚动市盈率"]
            if pd.notna(pe) and pe > 0:
                records.append({
                    "date": r["日期"].strftime("%Y-%m-%d"),
                    "pe": float(pe),
                    "close": float(r["收盘"]),
                })
        return records if len(records) >= 20 else None
    except Exception as e:
        log.warning(f"  {code} fetch failed: {e}")
        return None


def compute_percentile(records: list[dict]) -> dict | None:
    """从历史记录算百分位"""
    if not records:
        return None
    pe_vals = [r["pe"] for r in records]
    latest = records[-1]
    current_pe = latest["pe"]
    below = sum(1 for v in pe_vals if v < current_pe)
    pct = below / len(pe_vals) * 100
    return {
        "current_pe": round(current_pe, 2),
        "min_pe": round(min(pe_vals), 2),
        "max_pe": round(max(pe_vals), 2),
        "pct_5y": round(pct, 0),
        "data_points": len(records),
        "last_close": latest["close"],
        "date": latest["date"],
    }


# 乐咕乐股的 indexCode 形如 399006.SZ；中证接口不提供深证指数（399xxx）PE，
# 这里作为补充源。注意：乐咕自家 quantile 是全历史分位，我们只用它的 ttmPe 序列
# 自己算 5 年分位，口径与中证那几只保持一致。
LEGULUGU_CODES = {
    "399006": "399006.SZ",   # 创业板指
    "399001": "399001.SZ",   # 深证成指
    "399330": "399330.SZ",   # 深证100
}


def fetch_pe_data_legulegu(index_code: str, years: int = 5) -> list[dict] | None:
    """从乐咕乐股取指数 TTM PE 历史（补充中证接口没有的深证指数）。"""
    import requests
    import py_mini_racer
    import pandas as pd

    lg_code = LEGULUGU_CODES.get(index_code)
    if not lg_code:
        return None
    try:
        from akshare.stock_feature.stock_a_pe_and_pb import hash_code as _lg_hash
        js = py_mini_racer.MiniRacer()
        js.eval(_lg_hash)
        token = js.call("hex", datetime.now().date().isoformat()).lower()
        sess = requests.Session()
        sess.headers.update({
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://legulegu.com/stockdata/sz50-ttm-lyr",
        })
        resp = None
        for attempt in range(3):
            try:
                sess.get("https://legulegu.com/stockdata/sz50-ttm-lyr", timeout=20)
                resp = sess.get(
                    "https://legulegu.com/api/stockdata/index-basic-pe",
                    params={"token": token, "indexCode": lg_code},
                    timeout=30,
                )
                break
            except Exception:
                import time as _t
                _t.sleep(2 * (attempt + 1))
        if resp is None:
            return None
        rows = (resp.json() or {}).get("data") or []
        if not rows:
            return None
        cutoff = pd.Timestamp.now() - pd.DateOffset(years=years)
        out = []
        for r in rows:
            pe = r.get("ttmPe")
            d = r.get("date")
            if not pe or not d:
                continue
            ts = pd.to_datetime(d, errors="coerce")
            if pd.isna(ts) or ts < cutoff:
                continue
            out.append({"date": ts.strftime("%Y-%m-%d"), "pe": float(pe), "close": r.get("close")})
        out.sort(key=lambda x: x["date"])
        return out if len(out) >= 20 else None
    except Exception as e:
        log.warning(f"  {index_code} legulegu fetch failed: {e}")
        return None


STALE_WARN_DAYS = 7


def assess_freshness(data_date: str | None, today: date | None = None) -> tuple[int | None, str | None]:
    """评估估值数据落后多少个交易日/自然日。

    返回 (stale_days, warning)。数据本身没日期（fallback/参考值）时返回 (None, 提示)。
    """
    if not data_date:
        return None, "无数据日期（后备参考值），不可用于决策"
    try:
        d = datetime.strptime(str(data_date)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None, f"数据日期无法解析：{data_date}"
    ref = today or datetime.now().date()
    stale = (ref - d).days
    if stale > STALE_WARN_DAYS:
        return stale, f"数据已过期 {stale} 天（最后一天 {d}），结论不可信，请重跑抓取"
    return stale, None


def build_report() -> dict:
    """遍历所有目标指数，获取估值数据（带数据日期与过期检查）"""
    prev = {i.get("code"): i for i in load_cache().get("indices", []) if isinstance(i, dict)}
    results = []

    for idx in TARGET_INDICES:
        code = idx["code"]
        log.info(f"获取 {idx['name']} ({code})...")
        records = fetch_pe_data(code)
        source = "csindex"
        if not records and code.startswith("399"):
            # 中证不提供深证指数，换乐咕（TTM PE 序列，自己算 5 年分位）
            records = fetch_pe_data_legulegu(code)
            source = "legulegu"
        stats = compute_percentile(records) if records else None

        if stats:
            stale_days, warning = assess_freshness(stats["date"])
            results.append({
                "code": code,
                "name": idx["name"],
                "desc": idx["desc"],
                "etf": idx["etf"],
                "pe": stats["current_pe"],
                "pct_5y": stats["pct_5y"],
                "min_pe": stats["min_pe"],
                "max_pe": stats["max_pe"],
                "last_close": stats["last_close"],
                "date": stats["date"],          # 数据最后一天（不是抓取时间）
                "data_date": stats["date"],
                "stale_days": stale_days,
                "data_points": stats["data_points"],
                "source": source,
                "status": "stale" if warning else "ok",
                "warning": warning,
            })
            log.info(f"  ✅ PE={stats['current_pe']} 分位={stats['pct_5y']}% 数据日={stats['date']}"
                     + (f" ⚠️ {warning}" if warning else ""))
        else:
            # 抓取失败：优先沿用上一次的真实缓存（标注为 stale，绝不假装是最新）
            old = prev.get(code)
            if old and old.get("data_date") and old.get("data_date") != "(参考值)":
                stale_days, warning = assess_freshness(old.get("data_date"))
                results.append({
                    **old,
                    "status": "stale",
                    "stale_days": stale_days,
                    "source": old.get("source"),
                    "warning": f"本次抓取失败，沿用 {old.get('data_date')} 的旧数据"
                               + (f"（已过期 {stale_days} 天）" if stale_days else ""),
                })
                log.info(f"  ⚠️ 抓取失败，沿用旧数据 {old.get('data_date')}")
            elif code.startswith("399"):
                # 深证指数（创业板指）不在中证指数的样本里，接口返回空 → 不给假数字
                results.append({
                    "code": code,
                    "name": idx["name"],
                    "desc": idx["desc"],
                    "etf": idx["etf"],
                    "pe": None,
                    "pct_5y": None,
                    "min_pe": None,
                    "max_pe": None,
                    "last_close": None,
                    "date": None,
                    "data_date": None,
                    "stale_days": None,
                    "data_points": 0,
                    "source": None,
                    "status": "unsupported",
                    "warning": "中证指数接口不提供深证指数（399xxx）的 PE，本指数不参与温度判断",
                })
                log.info("  ℹ️ 深证指数：中证接口无 PE，标记 unsupported（不给假数字）")
            else:
                # 没有真实数据、也没有历史缓存 → 明确承认缺失，不编数字
                results.append({
                    "code": code,
                    "name": idx["name"],
                    "desc": idx["desc"],
                    "etf": idx["etf"],
                    "pe": None,
                    "pct_5y": None,
                    "min_pe": None,
                    "max_pe": None,
                    "last_close": None,
                    "date": None,
                    "data_date": None,
                    "stale_days": None,
                    "data_points": 0,
                    "source": None,
                    "status": "missing",
                    "warning": "抓取失败且无历史缓存，本指数不参与温度判断（不提供估测值）",
                })
                log.info("  ⚠️ 抓取失败且无缓存：标记 missing（不给估测数字）")

    ok_dates = [i["data_date"] for i in results if i.get("data_date")]
    data_date = max(ok_dates) if ok_dates else None
    warnings = [f"{i['name']}: {i['warning']}" for i in results if i.get("warning")]

    report = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "data_date": data_date,          # 全表最新数据日期
        "warnings": warnings,
        "indices": results,
    }

    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def load_cache() -> dict:
    """读取缓存（用于报告脚本）"""
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"generated_at": "未获取", "indices": []}


if __name__ == "__main__":
    log.basicConfig(level=log.INFO, format="%(message)s")
    report = build_report()
    ok = sum(1 for i in report["indices"] if i["status"] == "ok")
    print(f"✅ 已获取 {ok}/{len(report['indices'])} 个指数估值（数据日期 {report.get('data_date') or '未知'}）")
    for w in report.get("warnings") or []:
        print(f"  ⚠️ {w}")
