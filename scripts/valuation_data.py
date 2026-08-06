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

os.environ["HTTP_PROXY"] = "http://192.168.124.11:7890"
os.environ["HTTPS_PROXY"] = "http://192.168.124.11:7890"
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


def fetch_one(code: str) -> dict | None:
    """获取单只股票的历史估值 + 分位"""
    try:
        df = ak.stock_value_em(symbol=code)
        if df is None or df.empty:
            return None

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
        # 优先从财务缓存取默认股票列表（研究池）
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
