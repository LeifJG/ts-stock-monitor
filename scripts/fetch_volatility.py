#!/usr/bin/env python3
# ============================================================
# fetch_volatility.py — 真实历史波动率计算（网格步长依据）
# ------------------------------------------------------------
# 用 akshare 拉取持仓股票近 90 日日 K，计算 20 日收益率标准差
# （日波动率 σ），网格步长 = clamp(σ × 2, 2, 8)。
# 取代旧算法「|现价-成本价|/成本价」（把盈亏幅度误当波动率）。
#
# 输出:
#   stdout: JSON 摘要（供 API 解析）
#   data/volatility_cache.json: { generated_at, items: {code: {sigma, step, days}} }
# ============================================================

import json
import os
import sys
import math
import logging
from datetime import datetime, timedelta

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from net_utils import setup_proxy_env
setup_proxy_env()

import pandas as pd
import akshare as ak

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE, "..", "data", "volatility_cache.json")

LOOKBACK_DAYS = 90   # 拉取的日K天数
SIGMA_WINDOW = 20    # 收益率标准差窗口
STEP_MIN = 2.0       # 步长下限 %
STEP_MAX = 8.0       # 步长上限 %
STEP_K = 2.0         # 步长 = σ × K（约每 2 个日波动触及一档）


def is_hk(code: str) -> bool:
    return len(code) == 5


def fetch_daily_returns(code: str) -> pd.Series:
    """拉取日K并返回日收益率序列（%）。东财接口偶发断连：全部带重试，失败回退新浪源。"""
    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_DAYS + 15)
    start_s, end_s = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

    closes: pd.Series | None = None

    def try_em(fn, col: str, tail: int = 0) -> pd.Series | None:
        for _ in range(2):
            try:
                df = fn()
                c = col if col in df.columns else ("close" if "close" in df.columns else "收盘")
                s = df[c].astype(float)
                return s.tail(tail) if tail else s
            except Exception:
                continue
        return None

    if is_hk(code):
        closes = try_em(lambda: ak.stock_hk_hist(symbol=code, period="daily",
                        start_date=start_s, end_date=end_s, adjust=""), "收盘")
        if closes is None:
            closes = try_em(lambda: ak.stock_hk_daily(symbol=code), "close", LOOKBACK_DAYS + 20)
    else:
        closes = try_em(lambda: ak.stock_zh_a_hist(symbol=code, period="daily",
                        start_date=start_s, end_date=end_s, adjust=""), "收盘")
        if closes is None:
            # 新浪源要求交易所前缀: 6xx/688→sh, 0xx/3xx→sz, 8xx/4xx→bj
            if code.startswith(("6", "9", "5")):
                sym = f"sh{code}"
            elif code.startswith(("8", "4")):
                sym = f"bj{code}"
            else:
                sym = f"sz{code}"
            closes = try_em(lambda: ak.stock_zh_a_daily(symbol=sym), "close", LOOKBACK_DAYS + 20)

    if closes is None or len(closes) < SIGMA_WINDOW + 5:
        raise ValueError(f"K线数据不足(东财+新浪均失败): {len(closes) if closes is not None else 0} 行")
    return closes.pct_change().dropna() * 100


def compute_step(sigma: float) -> float:
    return round(max(STEP_MIN, min(sigma * STEP_K, STEP_MAX)), 1)


def main():
    # 持仓代码来源：命令行参数优先，否则读 portfolio.json
    codes = sys.argv[1:] if len(sys.argv) > 1 else []
    if not codes:
        pf_path = os.path.join(BASE, "..", "data", "portfolio.json")
        try:
            with open(pf_path, "r", encoding="utf-8") as f:
                codes = [str(p.get("code") or p.get("stockCode") or "")
                         for p in json.load(f)]
            codes = [c for c in codes if c]
        except Exception as e:
            log.error(f"读取持仓失败: {e}")
            sys.exit(1)

    items = {}
    ok = 0
    for code in codes:
        try:
            rets = fetch_daily_returns(code)
            sigma = float(rets.tail(SIGMA_WINDOW).std())
            step = compute_step(sigma)
            items[code] = {
                "sigma": round(sigma, 2),
                "step": step,
                "days": int(rets.tail(SIGMA_WINDOW).count()),
            }
            ok += 1
            print(f"  ✅ {code}: σ={sigma:.2f}% → 步长 {step}%", file=sys.stderr)
        except Exception as e:
            print(f"  ❌ {code}: {e}", file=sys.stderr)

    result = {
        "generated_at": int(datetime.now().timestamp() * 1000),
        "success": ok > 0,
        "total": len(codes),
        "ok": ok,
        "items": items,
    }

    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # stdout 只输出 JSON 摘要（供上层解析）
    print(json.dumps({"success": ok > 0, "ok": ok, "total": len(codes)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
