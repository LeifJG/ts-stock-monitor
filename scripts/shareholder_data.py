#!/usr/bin/env python3
"""
shareholder_data.py — 股东人数数据模块

从 akshare 获取每季度股东户数变化，缓存到 data/shareholder_cache.json
供 stock-api.ts 读取。
"""
import os, json, sys
from pathlib import Path

from net_utils import setup_proxy_env

setup_proxy_env()
import akshare as ak

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "shareholder_cache.json"


def fetch_one(code: str) -> dict | None:
    """获取单只股票的股东户数趋势（最新 12 期）"""
    try:
        df = ak.stock_zh_a_gdhs_detail_em(symbol=code)
        if df.empty:
            return None

        # 取最新 12 期，按日期降序
        df = df.sort_values("股东户数统计截止日", ascending=False).head(12)

        records = []
        for _, row in df.iterrows():
            records.append({
                "date": str(row["股东户数统计截止日"]),
                "holders": int(row["股东户数-本次"]),
                "prevHolders": int(row["股东户数-上次"]) if row.get("股东户数-上次") else None,
                "change": int(row["股东户数-增减"]) if row.get("股东户数-增减") else None,
                "changePct": round(float(row["股东户数-增减比例"]), 2) if row.get("股东户数-增减比例") else 0,
                "avgValue": round(float(row["户均持股市值"]), 0) if row.get("户均持股市值") else None,
                "avgShares": round(float(row["户均持股数量"]), 0) if row.get("户均持股数量") else None,
            })

        return {
            "code": code,
            "latestHolders": records[0]["holders"],
            "latestChangePct": records[0]["changePct"],
            "trend": records,
        }
    except Exception as e:
        print(f"[warn] {code}: {e}", file=sys.stderr)
        return None


def main():
    codes = sys.argv[1:] if len(sys.argv) > 1 else []

    if not codes:
        # 从分红缓存取默认股票列表
        div_file = Path(__file__).resolve().parent.parent / "data" / "dividend_yields.json"
        if div_file.exists():
            try:
                all_data = json.loads(div_file.read_text())
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
            print(f"  ✓ {code}: {result['latestHolders']:,} 户")

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
    print(f"\n✅ shareholder_cache.json updated: {len(data)} stocks")


if __name__ == "__main__":
    main()
