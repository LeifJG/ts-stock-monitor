#!/usr/bin/env python3
"""
fetch_insider.py — 获取 A 股高管增减持数据（通过 AKShare + 雪球数据源）
用法: python3 fetch_insider.py [代码1,代码2,...]
输出: JSON 数组 [{code, name, date, person, volume, price, holdAfter, position}]
运行：需要 akshare, pandas
"""

import sys
import json
import pandas as pd

def main():
    codes_input = sys.argv[1] if len(sys.argv) > 1 else ""

    # 解析代码列表
    watch_codes = [c.strip() for c in codes_input.split(",") if c.strip()]

    # 获取全量数据（AKShare 从雪球获取所有高管增减持记录）
    import akshare as ak
    df = ak.stock_inner_trade_xq()

    if df.empty:
        print(json.dumps({"success": True, "data": []}, ensure_ascii=False))
        return

    # 列名: 股票代码, 股票名称, 变动日期, 变动人, 变动股数, 成交均价,
    #      变动后持股数, 与董监高关系, 董监高职务

    # 如果没有指定代码，返回最新 10 条
    if not watch_codes:
        df_top = df.head(10)
    else:
        # 筛选：去掉 SH/SZ 前缀后匹配
        df["_code"] = df["股票代码"].str[2:]
        mask = df["_code"].isin(watch_codes)
        df_top = df[mask].copy()

    if df_top.empty:
        print(json.dumps({"success": True, "data": []}, ensure_ascii=False))
        return

    # 构建输出
    results = []
    for _, row in df_top.iterrows():
        code = row.get("_code", row.get("股票代码", ""))
        if not code:
            continue

        volume = row.get("变动股数", 0)
        if pd.isna(volume):
            volume = 0
        else:
            volume = int(volume)

        price = row.get("成交均价", None)
        if pd.isna(price):
            price = None
        else:
            price = round(float(price), 2)

        hold_after = row.get("变动后持股数", None)
        if pd.isna(hold_after):
            hold_after = None
        else:
            hold_after = int(hold_after)

        results.append({
            "code": str(code),
            "name": str(row.get("股票名称", "")),
            "date": str(row.get("变动日期", "")),
            "person": str(row.get("变动人", "")),
            "volume": volume,                     # +增持 -减持
            "price": price,                       # 成交均价
            "holdAfter": hold_after,              # 变动后持股数
            "position": str(row.get("董监高职务", "")),  # 职务
            "relationship": str(row.get("与董监高关系", "")),
        })

    print(json.dumps({"success": True, "data": results}, ensure_ascii=False))

if __name__ == "__main__":
    main()
