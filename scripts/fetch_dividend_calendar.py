#!/usr/bin/env python3
"""
fetch_dividend_calendar.py — 预测A股分红日历
用法: python3 fetch_dividend_calendar.py [代码1,代码2,...]
输出: JSON {success, data: [{code, name, events: [{date, perShare, confidence, type}]}]}

预测逻辑:
- 收集每只股票最近5年的已实施分红记录
- 如果某个月份连续2年以上有分红，预测下一年同月
- 如果一年两次分红（中期+年度），分别预测
- confidence: high(连续3+年) / medium(连续2年) / low(仅1次)
"""

import sys
import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

os.environ["HTTP_PROXY"] = os.environ.get("http_proxy", "http://192.168.124.11:7890")
os.environ["HTTPS_PROXY"] = os.environ.get("https_proxy", "http://192.168.124.11:7890")

import akshare as ak
import pandas as pd
import numpy as np

# ─── 股票名称映射（覆盖主要A股）───────────────────────────
STOCK_NAME_MAP = {
    "600519": "贵州茅台", "000858": "五粮液", "000568": "泸州老窖", "002304": "洋河股份",
    "600036": "招商银行", "601318": "中国平安", "000333": "美的集团", "600016": "民生银行",
    "600887": "伊利股份", "601398": "工商银行", "601939": "建设银行", "601288": "农业银行",
    "601988": "中国银行", "600000": "浦发银行", "601166": "兴业银行", "600276": "恒瑞医药",
    "000651": "格力电器", "600690": "海尔智家", "002594": "比亚迪", "300750": "宁德时代",
    "601012": "隆基绿能", "002415": "海康威视", "002230": "科大讯飞", "600900": "长江电力",
    "600030": "中信证券", "601688": "华泰证券", "600585": "海螺水泥", "300059": "东方财富",
    "000001": "平安银行", "002142": "宁波银行", "600809": "山西汾酒", "000596": "古井贡酒",
    "000002": "万科A", "600048": "保利发展", "600031": "三一重工", "601857": "中国石油",
    "600028": "中国石化", "601088": "中国神华", "601225": "陕西煤业", "601899": "紫金矿业",
    "600438": "通威股份", "601668": "中国建筑", "600309": "万华化学", "600941": "中国移动",
    "601728": "中国电信", "601919": "中远海控", "600104": "上汽集团", "000625": "长安汽车",
    "600066": "宇通客车", "000538": "云南白药", "600085": "同仁堂", "603259": "药明康德",
    # 港股通
    "00700": "腾讯控股", "09988": "阿里巴巴", "03690": "美团", "01810": "小米集团",
    "00941": "中国移动", "00005": "汇丰控股", "01299": "友邦保险", "00388": "香港交易所",
    "00883": "中国海洋石油", "09633": "农夫山泉", "02318": "中国平安",
    "02319": "蒙牛乳业", "02015": "理想汽车", "01024": "快手", "01928": "银河娱乐",
}


def get_dividend_history(code: str) -> list:
    """获取单只股票的历史分红明细，返回 [{date, perShare, year, month}]"""
    try:
        df = ak.stock_history_dividend_detail(symbol=code)
        if df is None or df.empty:
            return []

        records = []
        for _, row in df.iterrows():
            try:
                # 只取已实施的分红
                progress = str(row.get("进度", ""))
                if "实施" not in progress:
                    continue

                # 除权除息日
                ex_date = row.get("除权除息日")
                if ex_date is None or pd.isna(ex_date):
                    continue

                # 转为 YYYY-MM-DD
                if hasattr(ex_date, 'strftime'):
                    date_str = ex_date.strftime("%Y-%m-%d")
                else:
                    date_str = str(ex_date)[:10]

                dt = datetime.strptime(date_str, "%Y-%m-%d")
                if dt > datetime.now():
                    continue  # 未来的跳过

                # 派息：列名可能是 '派息'，值是 元/10股
                dividend = row.get("派息", 0)
                if dividend is None or pd.isna(dividend):
                    continue
                per_share = float(dividend) / 10.0  # 从 元/10股 转 元/股
                if per_share <= 0:
                    continue

                records.append({
                    "date": date_str,
                    "perShare": round(per_share, 4),
                    "year": dt.year,
                    "month": dt.month,
                })
            except (ValueError, TypeError):
                continue

        records.sort(key=lambda r: r["date"])
        return records
    except Exception as e:
        print(f"  [WARN] {code} 获取失败: {e}", file=sys.stderr)
        return []


def predict_next_events(records: list, code: str) -> list:
    """从历史记录预测未来分红事件"""
    if not records:
        return []

    name = STOCK_NAME_MAP.get(code, code)

    # 按月份分组
    month_groups = defaultdict(list)  # month -> [{date, perShare, year}]
    for r in records:
        month_groups[r["month"]].append(r)

    events = []
    now = datetime.now()
    current_year = now.year

    for month, group in month_groups.items():
        group.sort(key=lambda r: r["year"])
        years_paid = sorted(set(r["year"] for r in group))
        n_years = len(years_paid)

        # 连续年数
        max_streak = 1
        current_streak = 1
        for i in range(1, len(years_paid)):
            if years_paid[i] == years_paid[i-1] + 1:
                current_streak += 1
                max_streak = max(max_streak, current_streak)
            else:
                current_streak = 1

        if n_years < 2:
            continue  # 至少2年才有预测意义

        avg_per_share = round(sum(r["perShare"] for r in group) / len(group), 4)

        # 分红类型
        dividend_type = "annual" if month <= 6 else "interim"

        # 预测年份
        latest_year = max(years_paid)
        predict_year = latest_year + 1
        if predict_year < current_year:
            predict_year = current_year

        # 如果预测年份的当月已过，推到下一年
        if predict_year == current_year and (month < now.month or (month == now.month and now.day > 20)):
            predict_year += 1

        pred_date = f"{predict_year}-{month:02d}-15"
        confidence = "high" if max_streak >= 3 else "medium"

        events.append({
            "date": pred_date,
            "stockCode": code,
            "stockName": name,
            "perShare": avg_per_share,
            "confidence": confidence,
            "type": dividend_type,
        })

    events.sort(key=lambda e: e["date"])
    return events


def main():
    codes_input = sys.argv[1] if len(sys.argv) > 1 else ""
    watch_codes = [c.strip() for c in codes_input.replace("，", ",").split(",") if c.strip()]

    results = []
    for code in watch_codes:
        try:
            records = get_dividend_history(code)
            name = STOCK_NAME_MAP.get(code, code)
            events = predict_next_events(records, code)
            results.append({
                "code": code,
                "name": name,
                "recordsCount": len(records),
                "events": events,
            })
        except Exception as e:
            print(f"  [ERROR] {code}: {e}", file=sys.stderr)
            results.append({"code": code, "name": STOCK_NAME_MAP.get(code, code), "recordsCount": 0, "events": []})

    print(json.dumps({"success": True, "data": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
