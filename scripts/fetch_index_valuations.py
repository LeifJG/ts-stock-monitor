#!/usr/bin/env python3
"""
fetch_index_valuations.py — 获取主要指数估值数据并缓存
输出: JSON 到 cache/index_valuations.json（含 PE 百分位）
"""

import json, os, sys, time
from datetime import datetime, timedelta
import logging as log

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
FALLBACK_DATA = {
    "000300": {"name": "沪深300", "pe_range": (8.0, 18.0), "current_pe_approx": 12.5, "pct_approx": 35},
    "000016": {"name": "上证50",  "pe_range": (7.0, 16.0), "current_pe_approx": 10.8, "pct_approx": 30},
    "000905": {"name": "中证500", "pe_range": (15, 40),    "current_pe_approx": 24,   "pct_approx": 40},
    "000922": {"name": "中证红利","pe_range": (5.0, 12.0), "current_pe_approx": 7.0,  "pct_approx": 25},
    "000852": {"name": "中证1000","pe_range": (18, 50),    "current_pe_approx": 23,   "pct_approx": 30},
    "399006": {"name": "创业板指","pe_range": (25, 70),    "current_pe_approx": 32,   "pct_approx": 35},
    "931009": {"name": "红利低波","pe_range": (6.0, 14.0), "current_pe_approx": 7.5,  "pct_approx": 25},
    "000688": {"name": "科创50",  "pe_range": (30, 80),    "current_pe_approx": 45,   "pct_approx": 40},
}


def fetch_pe_data(code: str) -> list[dict] | None:
    """从 CSIndex 获取历史 PE 数据"""
    try:
        import akshare as ak
        import pandas as pd
        df = ak.stock_zh_index_hist_csindex(symbol=code)
        if df is None or df.empty:
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


def build_report() -> dict:
    """遍历所有目标指数，获取估值数据"""
    results = []
    for idx in TARGET_INDICES:
        code = idx["code"]
        label = f"{idx['name']} ({code})"
        log.info(f"获取 {label}...")
        records = fetch_pe_data(code)
        stats = compute_percentile(records) if records else None

        if stats:
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
                "date": stats["date"],
                "data_points": stats["data_points"],
                "status": "ok",
            })
            log.info(f"  ✅ PE={stats['current_pe']} 百分位={stats['pct_5y']}%")
        else:
            # 用后备数据
            fb = FALLBACK_DATA.get(code, {})
            log.info(f"  ⚠️ 用后备数据")
            results.append({
                "code": code,
                "name": idx["name"],
                "desc": idx["desc"],
                "etf": idx["etf"],
                "pe": fb.get("current_pe_approx", 0),
                "pct_5y": fb.get("pct_approx", 50),
                "min_pe": fb.get("pe_range", (0, 100))[0],
                "max_pe": fb.get("pe_range", (0, 100))[1],
                "last_close": 0,
                "date": "(参考值)",
                "data_points": 0,
                "status": "fallback",
            })

    report = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "indices": results,
    }

    # 写缓存
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
    print(f"✅ 已获取 {sum(1 for i in report['indices'] if i['status']=='ok')}/{len(report['indices'])} 个指数估值")
