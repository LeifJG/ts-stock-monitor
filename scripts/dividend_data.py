#!/usr/bin/env python3
"""
dividend_data.py — 统一股息率数据模块

本项目唯一的股息率数据源，所有组件（前端API、日报、预警）都通过此模块获取
数据来源：巨潮资讯网（cninfo）真实分红记录，通过 akshare 获取
缓存机制：减少对 cninfo 的重复请求

用法：
  python3 dividend_data.py [代码1,代码2,...]   # 查询并输出 JSON
  python3 dividend_data.py --refresh            # 强制刷新缓存
"""
import json
import os
import sys
import concurrent.futures
from datetime import datetime, timedelta

CACHE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "dividend_yields.json")

# ─── 代理配置 ──────────────────────────────────────────────────
# 在 WSL 中需要通过 Clash 代理访问 cninfo
PROXY = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY") or "http://192.168.124.11:7890"
HTTPS_PROXY = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or PROXY

def ensure_proxy_env():
    """确保环境变量中有代理设置（供 requests/urllib3 使用）"""
    if "http_proxy" not in os.environ:
        os.environ["http_proxy"] = PROXY
    if "https_proxy" not in os.environ:
        os.environ["https_proxy"] = HTTPS_PROXY

def get_cache() -> dict:
    """读取缓存，返回 {code: {dividend_per_share, updated_at, source}}"""
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_cache(data: dict):
    """写入缓存"""
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def is_cache_fresh(cache: dict, code: str, max_age_hours: int = 6) -> bool:
    """判断缓存是否还在有效期内"""
    if code not in cache:
        return False
    entry = cache[code]
    updated = entry.get("updated_at", "")
    if not updated:
        return False
    try:
        age = datetime.now() - datetime.fromisoformat(updated)
        return age < timedelta(hours=max_age_hours)
    except Exception:
        return False

def fetch_dividend_per_share_cninfo(code: str) -> float | None:
    """
    从 cninfo（巨潮资讯网）获取最近12个月的真实每股股利
    返回: 元/股，或 None
    """
    ensure_proxy_env()
    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_dividend_cninfo(symbol=code)
        if df is None or df.empty:
            return None

        twelve_months_ago = pd.Timestamp.now() - pd.DateOffset(months=12)

        # 按除权日过滤最近12个月
        if "除权日" in df.columns:
            df["除权日"] = pd.to_datetime(df["除权日"], errors="coerce")
            recent = df[df["除权日"] >= twelve_months_ago].dropna(subset=["除权日"])
        elif "实施方案公告日期" in df.columns:
            df["实施方案公告日期"] = pd.to_datetime(df["实施方案公告日期"], errors="coerce")
            recent = df[df["实施方案公告日期"] >= twelve_months_ago].dropna(subset=["实施方案公告日期"])
        else:
            recent = pd.DataFrame()

        if recent.empty:
            # 兜底：取最近一次年度分红
            annual = df[df["分红类型"].str.contains("年度", na=False)]
            if not annual.empty:
                latest_annual = annual.iloc[-1]
                total_dps = float(latest_annual["派息比例"]) / 10.0
                return round(total_dps, 4) if total_dps > 0 else None
            return None

        total_dps = recent["派息比例"].sum() / 10.0
        return round(total_dps, 4) if total_dps > 0 else None

    except ImportError:
        print("WARN: akshare not installed", file=sys.stderr)
        return None
    except Exception as e:
        print(f"WARN: cninfo fetch failed for {code}: {e}", file=sys.stderr)
        return None


def dividend_yield_from_cache_or_fetch(cache: dict, code: str, force_refresh: bool = False) -> dict | None:
    """
    从缓存或实时获取指定股票的每股股利
    返回: {dividend_per_share, source, updated_at}
    """
    now_iso = datetime.now().isoformat(timespec="seconds")

    # 缓存命中且未过期
    if not force_refresh and is_cache_fresh(cache, code):
        entry = cache[code]
        entry["source"] = "cache"
        return entry

    # 实时获取
    dps = fetch_dividend_per_share_cninfo(code)
    if dps is not None and dps > 0:
        entry = {
            "dividend_per_share": dps,
            "updated_at": now_iso,
            "source": "cninfo",
        }
        cache[code] = entry
        return entry

    # 获取失败，但有旧缓存就保留
    if code in cache:
        entry = cache[code]
        entry["source"] = "cache(stale)"
        return entry

    return None


def batch_fetch(codes: list[str], force_refresh: bool = False) -> dict:
    """
    批量获取多个股票的每股股利
    返回: {code: {dividend_per_share, source, updated_at} | None}
    """
    cache = get_cache()
    results = {}

    # 优先从缓存读
    fetch_codes = []
    for code in codes:
        if not force_refresh and is_cache_fresh(cache, code):
            results[code] = cache[code]
            results[code]["source"] = "cache"
        else:
            fetch_codes.append(code)

    # 需要实时获取的并行请求 cninfo
    if fetch_codes:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            fut_map = {pool.submit(fetch_dividend_per_share_cninfo, code): code for code in fetch_codes}
            for fut in concurrent.futures.as_completed(fut_map, timeout=30):
                code = fut_map[fut]
                try:
                    dps = fut.result()
                    if dps is not None and dps > 0:
                        entry = {
                            "dividend_per_share": dps,
                            "updated_at": datetime.now().isoformat(timespec="seconds"),
                            "source": "cninfo",
                        }
                        cache[code] = entry
                        results[code] = entry
                    else:
                        # 获取失败，保留旧缓存
                        if code in cache:
                            results[code] = cache[code]
                            results[code]["source"] = "cache(stale)"
                        else:
                            results[code] = None
                except Exception:
                    if code in cache:
                        results[code] = cache[code]
                        results[code]["source"] = "cache(stale)"
                    else:
                        results[code] = None

        # 写回缓存
        save_cache(cache)

    return results


def get_dividend_yield(dividend_per_share: float, current_price: float) -> float | None:
    """计算股息率（百分比）"""
    if dividend_per_share and current_price and current_price > 0:
        return round(dividend_per_share / current_price * 100, 2)
    return None


# ─── CLI 入口 ────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="统一股息率数据查询")
    parser.add_argument("codes", nargs="*", help="股票代码列表，逗号或空格分隔")
    parser.add_argument("--refresh", action="store_true", help="强制刷新所有缓存")
    parser.add_argument("--prices", nargs="*", help="对应股价，格式 code:price，如 600900:27.18")
    args = parser.parse_args()

    # 解析股票代码
    codes = []
    for c in args.codes:
        codes.extend(c.replace(",", " ").split())
    codes = [c.strip() for c in codes if c.strip()]

    if args.refresh:
        # 刷新全部缓存
        cache = get_cache()
        all_codes = list(cache.keys()) + codes
        all_codes = list(set(all_codes))
        data = batch_fetch(all_codes, force_refresh=True)
    elif codes:
        data = batch_fetch(codes, force_refresh=False)
    else:
        # 无参数：输出所有缓存
        data = get_cache()
        # 标记来源
        for k in data:
            data[k]["source"] = "cache"

    # 解析股价
    price_map = {}
    if args.prices:
        for p in args.prices:
            if ":" in p:
                c, pr = p.split(":", 1)
                price_map[c.strip()] = float(pr)

    # 输出格式：包含股息率
    output = {}
    for code, entry in data.items():
        if entry is None:
            output[code] = None
            continue
        out = dict(entry)
        # 如果有股价则计算股息率
        price = price_map.get(code)
        if price and out.get("dividend_per_share"):
            out["dividend_yield"] = get_dividend_yield(out["dividend_per_share"], price)
        output[code] = out

    print(json.dumps(output, ensure_ascii=False, indent=2))
