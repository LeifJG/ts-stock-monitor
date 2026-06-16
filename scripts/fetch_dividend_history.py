#!/usr/bin/env python3
"""
fetch_dividend_history.py — 获取A股历史分红数据（新浪财经数据源）
用法: python3 fetch_dividend_history.py [代码1,代码2,...]
输出: JSON [{code, name, records: [{date, perShare, growth}], streak, aristocrat}]
"""

import sys
import json
import os

# 强制走代理
os.environ["HTTP_PROXY"] = os.environ.get("http_proxy", "http://192.168.124.11:7890")
os.environ["HTTPS_PROXY"] = os.environ.get("https_proxy", "http://192.168.124.11:7890")

import akshare as ak
import pandas as pd


def main():
    codes_input = sys.argv[1] if len(sys.argv) > 1 else ""
    watch_codes = [c.strip() for c in codes_input.split(",") if c.strip()]

    results = []

    for code in watch_codes:
        try:
            df = ak.stock_history_dividend_detail(symbol=code, indicator="分红", date="")
        except Exception:
            results.append({"code": code, "name": "", "records": [], "streak": 0, "aristocrat": False})
            continue

        if df is None or df.empty:
            results.append({"code": code, "name": "", "records": [], "streak": 0, "aristocrat": False})
            continue

        # 只取已实施的分红记录
        df_impl = df[df["进度"] == "实施"].copy()
        if df_impl.empty:
            results.append({"code": code, "name": "", "records": [], "streak": 0, "aristocrat": False})
            continue

        # 提取股票名称（从第一条记录的回调中获取 - AKShare新版可能已包含）
        # 转换成每股派息 = 派息(每10股) / 10
        df_impl["每股派息"] = df_impl["派息"] / 10.0

        # 按除权除息日排序（最新的在前面）
        df_impl = df_impl.sort_values("除权除息日", ascending=False).reset_index(drop=True)

        records = []
        for _, row in df_impl.iterrows():
            records.append({
                "date": str(row.get("除权除息日", "")),
                "perShare": round(float(row["每股派息"]), 4),
                "announceDate": str(row.get("公告日期", "")),
            })

        # 计算分红增长年数（按自然年汇总）
        from collections import defaultdict
        yearly = defaultdict(float)
        for r in records:
            year = r["date"][:4] if r["date"] and len(r["date"]) >= 4 else ""
            if year:
                yearly[year] += r["perShare"]

        # 按年份排序（旧→新）
        sorted_years = sorted(yearly.items())
        yearly_list = [{"year": y, "total": round(v, 4)} for y, v in sorted_years]

        # 计算同比增长率
        # 先找最后一个完整的年度数据（非当年）
        import datetime
        current_year = str(datetime.datetime.now().year)
        complete_years = [y for y in yearly_list if y["year"] < current_year]

        # 从后往前数连续增长年数（基于完整年份）
        cons_growth = 0
        for i in range(len(complete_years) - 1, 0, -1):
            if complete_years[i]["total"] >= complete_years[i - 1]["total"] and complete_years[i - 1]["total"] > 0:
                cons_growth += 1
            else:
                break

        # 判断是否为分红贵族（连续5年+增长）
        aristocrat = cons_growth >= 5

        # 添加同比增长率到所有 year 上
        for i in range(len(yearly_list)):
            if i > 0 and yearly_list[i - 1]["total"] > 0:
                growth = (yearly_list[i]["total"] - yearly_list[i - 1]["total"]) / yearly_list[i - 1]["total"] * 100
                yearly_list[i]["growth"] = round(growth, 2)
            else:
                yearly_list[i]["growth"] = None

        results.append({
            "code": code,
            "name": "",
            "records": records[:4],  # 最近4次分红
            "yearly": yearly_list[-8:],  # 最近8年
            "streak": cons_growth,
            "aristocrat": aristocrat,
            "totalYears": len(yearly_list),
        })

    print(json.dumps({"success": True, "data": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
