#!/usr/bin/env python3
"""
fear_tech_data.py — 恐慌指数技术指标数据模块

为每只股票计算：
  - RSI(14)
  - 价格 vs MA20 偏离度
  - 量比（当日量 / 20日均量）
  - 5日累计涨跌幅
  - 20日平均振幅

数据来源：akshare 历史 K 线 → 东财行情
缓存路径：data/fear_tech_cache.json
"""

import json
import os
import sys
import math
import concurrent.futures
from datetime import datetime, timedelta

# 项目根目录
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_FILE = os.path.join(BASE_DIR, "data", "fear_tech_cache.json")

# ─── 代理配置 ──────────────────────────────────────────────────
# P1-6: 动态探测 Clash（直连优先），统一走共享网络模块
from net_utils import setup_proxy_env as ensure_proxy_env

# ─── 技术指标计算 ──────────────────────────────────────────────

def calc_rsi(prices: list, period: int = 14) -> float:
    """计算 RSI(period)"""
    if len(prices) < period + 1:
        return 50.0  # 数据不足返回中性
    gains = []
    losses = []
    for i in range(1, period + 1):
        diff = prices[-i] - prices[-i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 1)


def calc_ma(prices: list, period: int) -> float:
    """计算移动平均线"""
    if len(prices) < period:
        return prices[-1] if prices else 0
    return round(sum(prices[-period:]) / period, 2)


def calc_volume_ratio(volumes: list, period: int = 20) -> float:
    """量比 = 今日量 / 过去 period 日均量"""
    if len(volumes) < period + 1:
        return 1.0
    today_vol = volumes[-1]
    avg_vol = sum(volumes[-(period + 1):-1]) / period
    if avg_vol == 0:
        return 1.0
    return round(today_vol / avg_vol, 2)


# ─── K 线获取 ──────────────────────────────────────────────────

# 东财 push2his 接口 2026-09 起对 WSL 直连全部 RST（RemoteDisconnected，Clash 代理也 502），
# 腾讯 K 线接口 web.ifzq.gtimg.cn 全研究池 8/8 通过（A 股+港股，60 日数据齐），换为腾讯源
KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,80,qfq"


def _tencent_symbol(code: str) -> str:
    """600519 → sh600519 / 000333 → sz000333 / 00700(5位) → hk00700"""
    if len(code) == 5:  # 港股 5 位码（用户习惯带前导 0）
        return f"hk{code}"
    return f"{'sh' if code.startswith('6') else 'sz'}{code}"


def fetch_kline(code: str) -> dict:
    """获取单只股票的 K 线数据（腾讯源），返回技术指标"""
    ensure_proxy_env()
    import urllib.request

    result = {
        "code": code,
        "rsi_14": None,
        "ma20": None,
        "price_vs_ma20_pct": None,
        "volume_ratio": None,
        "change_5d_pct": None,
        "avg_amplitude_20d": None,
        "today_amplitude": None,
        "amplitude_ratio": None,
        "updated_at": datetime.now().isoformat(),
    }

    try:
        sym = _tencent_symbol(code)
        url = KLINE_HOST.format(sym=sym)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=20).read()
        data = json.loads(raw)
        dat = data.get("data", {}).get(sym, {})
        rows = dat.get("qfqday") or dat.get("day") or []
        # 行格式: [date, open, close, high, low, volume, ...]（腾讯顺序：开/收/高/低/量）
        if len(rows) < 2:
            return result
        rows = sorted(rows, key=lambda r: r[0])
        closes = [float(r[2]) for r in rows]
        highs = [float(r[3]) for r in rows]
        lows = [float(r[4]) for r in rows]
        volumes = [float(r[5]) if len(r) > 5 else 0.0 for r in rows]

        # RSI(14)
        result["rsi_14"] = calc_rsi(closes)

        # MA20 及价格偏离度
        if len(closes) >= 20:
            ma20 = calc_ma(closes, 20)
            result["ma20"] = ma20
            current_price = closes[-1]
            result["price_vs_ma20_pct"] = round((current_price - ma20) / ma20 * 100, 2)

        # 量比
        result["volume_ratio"] = calc_volume_ratio(volumes)

        # 5日涨跌幅
        if len(closes) >= 6:
            change_5d = round((closes[-1] - closes[-6]) / closes[-6] * 100, 2)
            result["change_5d_pct"] = change_5d

        # 20日平均振幅 和 振幅比
        if len(highs) >= 20 and len(lows) >= 20:
            amplitudes_20d = []
            for i in range(-20, 0):
                if highs[i] > 0 and lows[i] > 0:
                    amp = (highs[i] - lows[i]) / highs[i] * 100
                    amplitudes_20d.append(amp)
            if amplitudes_20d:
                result["avg_amplitude_20d"] = round(sum(amplitudes_20d) / len(amplitudes_20d), 2)
                today_amp = (highs[-1] - lows[-1]) / highs[-1] * 100 if highs[-1] > 0 else 0
                result["today_amplitude"] = round(today_amp, 2)
                avg_amp = result["avg_amplitude_20d"]
                result["amplitude_ratio"] = round(today_amp / avg_amp, 2) if avg_amp > 0 else 1.0

        result["data_points"] = len(closes)

    except Exception as e:
        # 静默失败，结果中的字段保持 None
        pass

    return result


def batch_fetch(codes: list, max_workers: int = 3) -> dict:
    """并发获取多只股票的 K 线指标"""
    ensure_proxy_env()
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_code = {executor.submit(fetch_kline, c): c for c in codes if c}
        for future in concurrent.futures.as_completed(future_to_code):
            code = future_to_code[future]
            try:
                data = future.result()
                results[code] = data
            except Exception:
                pass
    return results


# ─── 缓存管理 ──────────────────────────────────────────────────

def get_cache() -> dict:
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def save_cache(data: dict):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_cache_fresh(cache: dict, code: str, max_age_hours: int = 2) -> bool:
    """K 线数据2小时刷新一次（盘中变化慢）"""
    entry = cache.get(code)
    if not entry:
        return False
    updated = entry.get("updated_at")
    if not updated:
        return False
    try:
        age = datetime.now() - datetime.fromisoformat(updated)
        return age.total_seconds() < max_age_hours * 3600
    except Exception:
        return False


# ─── 主入口 ──────────────────────────────────────────────────

def main():
    codes = sys.argv[1:]
    if not codes:
        print("用法: python3 fear_tech_data.py [代码1,代码2,...]")
        sys.exit(1)

    codes_list = [c.strip() for c in codes[0].split(",") if c.strip()]

    cache = get_cache()
    to_fetch = [c for c in codes_list if not is_cache_fresh(cache, c)]

    if to_fetch:
        print(f"获取 {len(to_fetch)} 只股票的技术指标...", file=sys.stderr)
        new_data = batch_fetch(to_fetch)
        cache.update(new_data)
        save_cache(cache)
    else:
        print("所有数据缓存命中", file=sys.stderr)

    # 输出请求的代码数据
    output = {}
    for c in codes_list:
        if c in cache:
            output[c] = cache[c]
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
