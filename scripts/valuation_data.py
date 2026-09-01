#!/usr/bin/env python3
"""
valuation_data.py — 估值分位数据模块

从东财获取个股历史 PE(TTM)/PB 数据（2018至今），
计算当前估值在近 1/3/5 年历史中的百分位，
缓存到 data/valuation_cache.json 供前端展示。

用法:
    python3 scripts/valuation_data.py                # 全量（从 dividend_yields 取默认列表）
    python3 scripts/valuation_data.py 600036 000858  # 指定代码
"""
import os, json, sys, math
from pathlib import Path

# 注意：本脚本禁用代理直连。百度估值接口(finance.baidu.com)经 Clash 代理会
# DNS 失败，东财/百度均是国内站直连即可（P1-6 后不再有硬编码代理默认值）。
for _k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(_k, None)

import akshare as ak
import numpy as np
import pandas as pd

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "valuation_cache.json"


def percentile_rank(series, value):
    """当前值在历史序列中的百分位（0-100），越小越低估"""
    if value is None or math.isnan(value):
        return None
    valid = series[~np.isnan(series)]
    if len(valid) < 20:
        return None
    below = float((valid < value).mean())
    equal = float((valid == value).mean())
    return round((below + 0.5 * equal) * 100, 1)


def recent_window(series, years):
    """取最近 N 年的数据（按日期索引）"""
    if series.empty:
        return series
    cutoff = series.index[-1] - pd.DateOffset(years=years)
    return series[series.index >= cutoff]


def is_hk(code: str) -> bool:
    """港股：5 位数字代码（如 01810/09988）"""
    return code.isdigit() and len(code) == 5


def _pct_result(code: str, dates, pe_vals, pb_vals, cur_price=None) -> dict | None:
    """PE/PB 历史序列 → 统一的分位/中位/极值/走势结构（A股与港股共用）"""
    pe = pd.Series(pe_vals, index=pd.to_datetime(dates)).dropna()
    pb = pd.Series(pb_vals, index=pd.to_datetime(dates)).dropna()
    if pe.empty and pb.empty:
        return None

    cur_pe = float(pe.iloc[-1]) if not pe.empty else float("nan")
    cur_pb = float(pb.iloc[-1]) if not pb.empty else float("nan")

    result = {
        "code": code,
        "price": round(cur_price, 2) if cur_price is not None else None,
        "pe_ttm": round(cur_pe, 2) if not math.isnan(cur_pe) else None,
        "pb": round(cur_pb, 2) if not math.isnan(cur_pb) else None,
        "pe_median_5y": round(float(pe[-250 * 5:].median()), 2) if not pe.empty else None,
        "pb_median_5y": round(float(pb[-250 * 5:].median()), 2) if not pb.empty else None,
        "updated_at": str((pe.index[-1] if not pe.empty else pb.index[-1]).date()),
    }

    for years in (1, 3, 5):
        label = f"{years}y"
        pe_w = recent_window(pe, years)
        pb_w = recent_window(pb, years)
        result[f"pe_pct_{label}"] = percentile_rank(pe_w.to_numpy(), cur_pe)
        result[f"pb_pct_{label}"] = percentile_rank(pb_w.to_numpy(), cur_pb)

    pe5 = pe[-250 * 5:]
    pb5 = pb[-250 * 5:]
    result["pe_min_5y"] = round(float(pe5.min()), 2) if not pe5.empty else None
    result["pe_max_5y"] = round(float(pe5.max()), 2) if not pe5.empty else None
    result["pb_min_5y"] = round(float(pb5.min()), 2) if not pb5.empty else None
    result["pb_max_5y"] = round(float(pb5.max()), 2) if not pb5.empty else None

    hist_pe = pe[-250:]
    hist_pb = pb[-250:]
    result["history"] = [
        {"date": str(d.date()),
         "pe": round(float(p), 2) if p is not None and not math.isnan(p) else None,
         "pb": round(float(b), 2) if b is not None and not math.isnan(b) else None}
        for d, p, b in zip(hist_pe.index, hist_pe.to_numpy(), hist_pb.to_numpy())
    ]
    return result


def fetch_one_hk(code: str) -> dict | None:
    """港股估值分位：百度股市通历史 PE(TTM)/市净率（近五年，自算分位）"""
    import time

    def _fetch(indicator: str):
        last_err: Exception | None = None
        for attempt in range(3):  # 百度接口偶发 DNS 抖动，重试兜底
            try:
                return ak.stock_hk_valuation_baidu(symbol=code, indicator=indicator, period="近五年")
            except Exception as e:
                last_err = e
                time.sleep(2 * (attempt + 1))
        raise last_err if last_err else RuntimeError("unknown fetch error")

    try:
        pe_df = _fetch("市盈率(TTM)")
        try:
            pb_df = _fetch("市净率")
        except Exception:
            pb_df = None
        if pe_df is None or pe_df.empty:
            return None

        # 以 PE 序列为主轴，PB 按日期对齐
        pe_s = pe_df.set_index(pd.to_datetime(pe_df["date"]))["value"].astype(float)
        pb_s = (pb_df.set_index(pd.to_datetime(pb_df["date"]))["value"].astype(float)
                if pb_df is not None and not pb_df.empty else pd.Series(dtype=float))

        idx = pe_s.index
        pe_vals = pe_s.reindex(idx).to_numpy()
        pb_vals = pb_s.reindex(idx).to_numpy()

        # 现价（HKD）：腾讯行情字段 3
        cur_price = None
        try:
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            txt = opener.open(f"https://qt.gtimg.cn/q=hk{code}", timeout=8).read().decode("gbk")
            fields = txt.split('"')[1].split("~")
            if len(fields) > 3 and fields[3]:
                cur_price = float(fields[3])
        except Exception:
            pass

        return _pct_result(code, idx, pe_vals, pb_vals, cur_price)
    except Exception as e:
        print(f"[warn] {code}(HK): {e}", file=sys.stderr)
        return None


def fetch_one(code: str) -> dict | None:
    """获取单只股票的历史估值 + 分位（A股走东财，港股走百度）"""
    if is_hk(code):
        return fetch_one_hk(code)
    # 东财接口无内置重试，DNS/网络抖动一次就废（美的曾因此 27 天未更新），显式重试+退避
    df = None
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            df = ak.stock_value_em(symbol=code)
            break
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    if df is None:
        if last_err:
            print(f"[warn] {code}: 东财估值接口重试 3 次仍失败: {last_err}", file=sys.stderr)
        return None
    if df.empty:
        return None

    try:
        df["数据日期"] = pd.to_datetime(df["数据日期"])
        df = df.sort_values("数据日期").reset_index(drop=True)

        pe = df.set_index("数据日期")["PE(TTM)"].astype(float)
        pb = df.set_index("数据日期")["市净率"].astype(float)
        price = df.set_index("数据日期")["当日收盘价"].astype(float)

        cur_pe = float(pe.iloc[-1])
        cur_pb = float(pb.iloc[-1])
        cur_price = float(price.iloc[-1])

        result = {
            "code": code,
            "price": round(cur_price, 2),
            "pe_ttm": round(cur_pe, 2),
            "pb": round(cur_pb, 2),
            "pe_median_5y": round(float(pe[-250*5:].median()), 2),
            "pb_median_5y": round(float(pb[-250*5:].median()), 2),
            "updated_at": str(pe.index[-1].date()),
        }

        # 各窗口分位（1年/3年/5年/全部）
        for years in (1, 3, 5):
            label = f"{years}y"
            pe_w = recent_window(pe, years)
            pb_w = recent_window(pb, years)
            result[f"pe_pct_{label}"] = percentile_rank(pe_w.to_numpy(), cur_pe)
            result[f"pb_pct_{label}"] = percentile_rank(pb_w.to_numpy(), cur_pb)

        # 5年极值
        pe5 = pe[-250*5:]
        pb5 = pb[-250*5:]
        result["pe_min_5y"] = round(float(pe5.min()), 2)
        result["pe_max_5y"] = round(float(pe5.max()), 2)
        result["pb_min_5y"] = round(float(pb5.min()), 2)
        result["pb_max_5y"] = round(float(pb5.max()), 2)

        # 近 250 个交易日的 PE/PB 走势（用于前端画迷你图）
        hist_pe = pe[-250:]
        hist_pb = pb[-250:]
        result["history"] = [
            {
                "date": str(d.date()),
                "pe": round(float(p), 2) if not math.isnan(p) else None,
                "pb": round(float(b), 2) if not math.isnan(b) else None,
            }
            for d, p, b in zip(hist_pe.index, hist_pe.to_numpy(), hist_pb.to_numpy())
        ]

        return result
    except Exception as e:
        print(f"[warn] {code}: {e}", file=sys.stderr)
        return None


def main():
    codes = sys.argv[1:] if len(sys.argv) > 1 else []

    if not codes:
        # 默认清单 = 研究池(财务缓存) ∪ 当前持仓（保证持仓股必有分位数据，
        # 港股持仓经 fetch_one_hk 自动覆盖）
        fin_file = Path(__file__).resolve().parent.parent / "data" / "financials_cache.json"
        if fin_file.exists():
            try:
                all_data = json.loads(fin_file.read_text())
                codes = list(all_data.keys())
            except Exception:
                codes = []
        if not codes:
            codes = ["600519", "000858", "600036", "601318", "000333",
                     "600900", "000651", "600887", "000538", "002415"]
        try:
            pf_file = Path(__file__).resolve().parent.parent / "data" / "portfolio.json"
            for p in json.loads(pf_file.read_text()):
                c = str(p.get("code") or p.get("stockCode") or "")
                if c and c not in codes:
                    codes.append(c)
        except Exception:
            pass

    data = {}
    for code in codes:
        result = fetch_one(code)
        if result:
            data[code] = result
            print(f"  ✓ {code}: PE={result['pe_ttm']} (5y分位 {result.get('pe_pct_5y')}%), "
                  f"PB={result['pb']} (5y分位 {result.get('pb_pct_5y')}%)")

    # 合并现有缓存
    old = {}
    if CACHE_FILE.exists():
        try:
            old = json.loads(CACHE_FILE.read_text())
        except Exception:
            pass
    old.update(data)

    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(old, ensure_ascii=False, indent=2))
    print(f"\n✅ valuation_cache.json updated: {len(data)} stocks")


if __name__ == "__main__":
    main()
