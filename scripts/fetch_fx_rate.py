#!/usr/bin/env python3
"""
fetch_fx_rate.py — 港币兑人民币汇率抓取（P1-5：替代硬编码 0.86）
------------------------------------------------------------
数据源: 中国银行牌价（akshare currency_boc_sina），取最新交易日的
        中行折算价，缺值时依次回退央行中间价/中行汇买价。
输出:   cache/fx_rate.json  { rate, source, date, updated_at }
        rate 为 1 港币 = ? 人民币（如 0.865）
失败策略: 抓取失败时不覆盖已有缓存，保留上一份可用汇率。
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from net_utils import setup_proxy_env

setup_proxy_env()

BASE_DIR = Path(__file__).resolve().parent.parent
OUT = BASE_DIR / "cache" / "fx_rate.json"

# 数值合理区间（HKD/CNY 历史约 0.75~0.98），防脏数据
RATE_MIN, RATE_MAX = 0.75, 0.98


def main() -> int:
    import akshare as ak

    end = datetime.now()
    start = end - timedelta(days=10)
    df = ak.currency_boc_sina(
        symbol="港币",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
    )
    if df is None or df.empty:
        print("WARN: boc_sina 返回空", file=sys.stderr)
        return 1

    # 从最新行向下找第一个可用值
    rate, used_col, used_date = None, None, None
    for _, row in df.iloc[::-1].iterrows():
        for col in ("中行折算价", "央行中间价", "中行汇买价"):
            v = row.get(col)
            if v is not None and v == v:  # 非 NaN
                r = float(v) / 100.0
                if RATE_MIN <= r <= RATE_MAX:
                    rate, used_col, used_date = r, col, str(row.get("日期", ""))
                    break
        if rate:
            break

    if rate is None:
        print("WARN: 无有效汇率值", file=sys.stderr)
        return 1

    payload = {
        "rate": round(rate, 4),
        "source": f"中行牌价.{used_col}",
        "date": used_date,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), "utf-8")
    print(f"OK: HKD/CNY = {payload['rate']} ({used_col} @ {used_date})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
