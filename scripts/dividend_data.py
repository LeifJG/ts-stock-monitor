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
# P1-6: 动态探测 Clash（直连优先），统一走共享网络模块
from net_utils import setup_proxy_env as ensure_proxy_env

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

def is_hk_code(code: str) -> bool:
    """港股代码 = 5 位纯数字（A 股 6 位）"""
    return bool(code) and len(str(code)) == 5 and str(code).isdigit()


# ─── 港股分红（东财 stock_hk_dividend_payout_em）─────────────────
# cninfo（巨潮）只有 A 股分红数据，港股调用会直接抛「'实施方案公告日期'」KeyError，
# 导致港股「股东回报」维度恒为 0、护城河评级被系统性低估（腾讯 64 / 阿里 44）。
# 这里改用东财港股分红派息接口，并把各种币种统一折算成港币。

_FX_TO_HKD = {
    "港币": 1.0, "港元": 1.0, "hkd": 1.0,
    "人民币": 1.09, "rmb": 1.09, "cny": 1.09,
    "美元": 7.80, "美金": 7.80, "usd": 7.80,
    "欧元": 8.50, "eur": 8.50,
    "英镑": 9.90, "gbp": 9.90,
    "新加坡元": 5.80, "sgb": 5.80,
    "日元": 0.052, "jpy": 0.052,
}


def parse_hk_dividend_amount(text) -> float | None:
    """把「每股派港币0.12元」「每股派美元0.125元(相当于港币0.97641元(计算值))」
    解析成港币每股金额；解析不了返回 None。

    优先用公告里已给出的港币折算值，避免自己换汇引入误差。
    """
    import re

    s = str(text or "")
    if not s or s == "nan":
        return None
    # ① 公告自带折算：相当于港币X元
    m = re.search(r"相当于港币\s*([\d.]+)", s)
    if m:
        try:
            return round(float(m.group(1)), 4)
        except ValueError:
            return None
    # ② 币种 + 金额
    low = s.lower()
    rate = None
    for kw, r in _FX_TO_HKD.items():
        if kw in s or kw in low:
            rate = r
            break
    if rate is None:
        rate = 1.08  # 未识别币种（大概率人民币）按接近港币处理，避免整只票漏掉
    m = re.search(r"([\d]+(?:\.\d+)?)\s*元", s)
    if not m:
        return None
    try:
        return round(float(m.group(1)) * rate, 4)
    except ValueError:
        return None


# 上一次港股分红查询的状态：em_hk=有分红 / empty=确认无分红 / error=取数失败
_HK_LAST_STATUS: dict[str, str] = {}


def fetch_dividend_per_share_hk(code: str) -> float | None:
    """港股：最近 12 个月（按除净日）每股派息合计（港币）；无记录返回 None。

    有两类兜底：
      - 除净日缺失/过旧 → 退化为「最近一个财政年度的分配合计」
      - 完全无分红记录（如小米 01810 长年不分红）→ 返回 None（真实情况，不是数据缺失）
    状态同时记到 _HK_LAST_STATUS，供上层区分「确认无分红 empty」与「取数失败 error」。
    """
    ensure_proxy_env()
    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_hk_dividend_payout_em(symbol=code)
        if df is None or df.empty or "分红方案" not in df.columns:
            _HK_LAST_STATUS[code] = "empty"
            return None

        df = df.copy()
        df["_dps"] = df["分红方案"].map(parse_hk_dividend_amount)
        df = df[df["_dps"].notna() & (df["_dps"] > 0)]
        if df.empty:
            _HK_LAST_STATUS[code] = "empty"
            return None

        # ① 除净日近 12 个月
        if "除净日" in df.columns:
            exd = pd.to_datetime(df["除净日"], errors="coerce")
            cutoff = pd.Timestamp.now() - pd.DateOffset(months=12)
            recent = df[exd >= cutoff]
            if not recent.empty:
                total = float(recent["_dps"].sum())
                if total > 0:
                    _HK_LAST_STATUS[code] = "em_hk"
                    return round(total, 4)

        # ② 兜底：最近一个财政年度的分配合计（含特别/中期分配）
        fy = pd.to_numeric(df.get("财政年度"), errors="coerce")
        if fy is not None and fy.notna().any():
            latest_fy = fy.max()
            same_fy = df[fy == latest_fy]
            total = float(same_fy["_dps"].sum())
            if total > 0:
                _HK_LAST_STATUS[code] = "em_hk"
                return round(total, 4)
        _HK_LAST_STATUS[code] = "empty"
        return None

    except ImportError:
        print("WARN: akshare not installed", file=sys.stderr)
        _HK_LAST_STATUS[code] = "error"
        return None
    except Exception as e:
        print(f"WARN: hk dividend fetch failed for {code}: {e}", file=sys.stderr)
        _HK_LAST_STATUS[code] = "error"
        return None


def fetch_hk_dividend_status(code: str) -> tuple[float | None, str]:
    """港股分红 + 状态：有分红 em_hk / 确认无分红 empty / 取数失败 error"""
    dps = fetch_dividend_per_share_hk(code)
    if dps:
        return dps, "em_hk"
    return None, _HK_LAST_STATUS.get(code, "error")


# ─── 港股回购（东财 RPT_HK_BUYBACK）───────────────────────────────
# 「股东回报」若只看分红，会把靠回购回报股东的公司打成 0 分：
# 腾讯分红 payout 仅 17.7%（股东回报拿 0 分），但它每年回购上千亿港币。
# 东财港股回购接口报告名 RPT_HK_BUYBACK（约 3.7 万页日频记录），
# 字段：SECURITY_CODE/TRADE_DATE/REPO_NUM(股数)/REPO_AMT(金额)/REPO_NUM_PCG(占总股本%)。

BUYBACK_CACHE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "buyback_hk_cache.json")
_BUYBACK_TTL_HOURS = 24 * 3  # 回购数据日频，3 天够用


def _load_buyback_cache() -> dict:
    try:
        if os.path.exists(BUYBACK_CACHE_FILE):
            with open(BUYBACK_CACHE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_buyback_cache(data: dict):
    try:
        os.makedirs(os.path.dirname(BUYBACK_CACHE_FILE), exist_ok=True)
        with open(BUYBACK_CACHE_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def fetch_hk_buyback_ratio(code: str, force_refresh: bool = False) -> float | None:
    """港股近 12 个月回购股数占总股本的比例（%）。

    与价格无关，可直接当作「回购收益率」与股息率相加。
    无回购记录返回 0.0（真实情况），完全取不到数据返回 None。
    """
    cache = _load_buyback_cache()
    entry = cache.get(code)
    if entry and not force_refresh:
        try:
            age = datetime.now() - datetime.fromisoformat(entry["updated_at"])
            if age < timedelta(hours=_BUYBACK_TTL_HOURS):
                return entry.get("buyback_ratio_pct")
        except Exception:
            pass

    ensure_proxy_env()
    try:
        import urllib.request
        import urllib.parse

        base = "https://datacenter-web.eastmoney.com/api/data/v1/get"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
        cutoff = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        rows: list[dict] = []
        for page in range(1, 4):  # 最多 3 页（1500 条，腾讯一年约 250 条）
            params = {
                "reportName": "RPT_HK_BUYBACK",
                "columns": "SECURITY_CODE,TRADE_DATE,REPO_NUM,REPO_AMT,REPO_NUM_PCG,CURRENCY",
                "filter": f'(SECURITY_CODE="{code}")(TRADE_DATE>=\'{cutoff}\')',
                "pageNumber": page,
                "pageSize": 500,
                "sortColumns": "TRADE_DATE",
                "sortTypes": -1,
            }
            url = base + "?" + urllib.parse.urlencode(params)
            body = json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=15).read().decode())
            data = ((body.get("result") or {}).get("data")) or []
            rows.extend(data)
            if len(data) < 500:
                break

        if not rows:
            cache[code] = {"buyback_ratio_pct": 0.0, "updated_at": datetime.now().isoformat(timespec="seconds"),
                           "rows": 0, "source": "em_hk"}
            _save_buyback_cache(cache)
            return 0.0

        # 总股本：任一行 REPO_NUM / (REPO_NUM_PCG/100) 反推
        shares_total = None
        for r in rows:
            num, pcg = r.get("REPO_NUM") or 0, r.get("REPO_NUM_PCG") or 0
            if num and pcg:
                shares_total = num / (pcg / 100.0)
                break
        if not shares_total:
            return None

        repo_shares = sum(float(r.get("REPO_NUM") or 0) for r in rows)
        repo_amt = sum(float(r.get("REPO_AMT") or 0) for r in rows)
        ratio = round(repo_shares / shares_total * 100, 3)
        cache[code] = {
            "buyback_ratio_pct": ratio,
            "repo_shares": repo_shares,
            "repo_amt": repo_amt,
            "rows": len(rows),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "source": "em_hk",
        }
        _save_buyback_cache(cache)
        return ratio

    except Exception as e:
        print(f"WARN: hk buyback fetch failed for {code}: {e}", file=sys.stderr)
        if entry:
            return entry.get("buyback_ratio_pct")
        return None


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


def fetch_dividend_per_share(code: str) -> tuple[float | None, str]:
    """按市场分派数据源：A股 → cninfo（巨潮），港股 → 东财港股分红派息。

    返回 (每股股息, 来源标记)；来源 = cninfo / em_hk / empty_hk（确认无分红）/ none（取数失败）
    「确认无分红」要单独标记：小米 01810 从不分红，不能让它落回 payout÷PE 的估算值
    （会把股息率凭空算成 3%）。
    """
    if is_hk_code(code):
        dps, status = fetch_hk_dividend_status(code)
        if dps:
            return dps, "em_hk"
        return None, ("empty_hk" if status == "empty" else "none")
    dps = fetch_dividend_per_share_cninfo(code)
    return dps, ("cninfo" if dps else "none")


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

    # 实时获取（A股走 cninfo，港股走东财）
    dps, src = fetch_dividend_per_share(code)
    if dps is not None and dps > 0:
        entry = {
            "dividend_per_share": dps,
            "updated_at": now_iso,
            "source": src,
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
            fut_map = {pool.submit(fetch_dividend_per_share, code): code for code in fetch_codes}
            for fut in concurrent.futures.as_completed(fut_map, timeout=30):
                code = fut_map[fut]
                try:
                    dps, src = fut.result()
                    if dps is not None and dps > 0:
                        entry = {
                            "dividend_per_share": dps,
                            "updated_at": datetime.now().isoformat(timespec="seconds"),
                            "source": src,
                        }
                        cache[code] = entry
                        results[code] = entry
                    elif src == "empty_hk":
                        # 港股确认无分红：缓存 0，让下游别再用估算值糊上去
                        entry = {
                            "dividend_per_share": 0.0,
                            "updated_at": datetime.now().isoformat(timespec="seconds"),
                            "source": "empty_hk",
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
