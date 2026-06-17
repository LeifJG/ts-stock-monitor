#!/usr/bin/env python3
"""
alert_checker.py — 服务端预警检查引擎
检查所有规则（含成本价预警、分红日预警），输出触发的告警文本
输出: 格式化的 Markdown 文本，直接可用于推送
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

os.environ["HTTP_PROXY"] = os.environ.get("http_proxy", "http://192.168.124.11:7890")
os.environ["HTTPS_PROXY"] = os.environ.get("https_proxy", "http://192.168.124.11:7890")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"
ALERTS_FILE = DATA_DIR / "alerts.json"


# ─── 工具函数 ────────────────────────────────────────────────

def fetch_tencent(codes: list) -> dict:
    """批量获取腾讯行情"""
    if not codes:
        return {}
    items = []
    for c in codes:
        if len(c) == 5:
            items.append(f"hk{c}")
        elif c.startswith("6"):
            items.append(f"sh{c}")
        else:
            items.append(f"sz{c}")

    url = f"https://qt.gtimg.cn/q={','.join(items)}"
    proxy = urllib.request.ProxyHandler({
        'http': os.environ['HTTP_PROXY'],
        'https': os.environ['HTTPS_PROXY'],
    })
    opener = urllib.request.build_opener(proxy)

    try:
        resp = opener.open(url, timeout=15)
        text = resp.read().decode("gbk")
    except Exception:
        return {}

    result = {}
    for line in text.strip().split("\n"):
        m = re.match(r'v_(hk|sh|sz|bj)(\d+)="(.+)"', line)
        if not m:
            continue
        code = m.group(2)
        fields = m.group(3).split("~")
        if len(fields) < 40:
            continue
        price = float(fields[3]) if fields[3] else 0
        prev_close = float(fields[4]) if fields[4] else 0
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
        pe = float(fields[39]) if fields[39] else None
        turnover = float(fields[43] if m.group(1) == "hk" else fields[38]) or None
        pb = None if m.group(1) == "hk" else (float(fields[46]) if fields[46] else None)
        mkcap = float(fields[45]) if fields[45] else None

        result[code] = {
            "name": fields[1] or code,
            "price": price,
            "changePercent": round(change_pct, 2),
            "pe": pe,
            "pb": pb,
            "turnoverRate": turnover,
            "marketCap": mkcap,
            "high": float(fields[33]) if fields[33] else price,
            "low": float(fields[34]) if fields[34] else price,
            "dividendYield": round((0.40 / pe * 100), 2) if pe and pe > 0 else None,
        }
    return result


def get_field_value(stock: dict, field: str) -> float | None:
    """从行情数据中提取告警字段的值"""
    mapping = {
        "currentPrice": "price",
        "changePercent": "changePercent",
        "pe": "pe",
        "pb": "pb",
        "marketCap": "marketCap",
        "turnoverRate": "turnoverRate",
        "volume": None,  # 简化处理
        "fearIndex": None,
        "roe": None,
        "dividendYield": "dividendYield",
        "dividendPayoutRatio": None,
        "debtRatio": None,
    }
    key = mapping.get(field)
    if key:
        return stock.get(key)
    return None


def check_rule(rule: dict, stock: dict, portfolio_map: dict, upcoming_dividends: list) -> list:
    """检查单条规则，返回触发消息列表"""
    results = []
    code = rule.get("stockCode", "")
    field = rule.get("field", "")
    op = rule.get("operator", ">")
    val = rule.get("value", 0)
    label = rule.get("label", "")
    alert_type = rule.get("alertType", "field")

    # 需要检查的股票列表
    check_codes = [code] if code else list(stock.keys())

    for c in check_codes:
        s = stock.get(c)
        if not s:
            continue
        name = s["name"]

        if alert_type == "costBasis":
            # 成本价预警：当前价低于成本价 val%
            pos = portfolio_map.get(c)
            if not pos:
                continue
            cost_basis = pos.get("buyPrice", 0)
            if cost_basis <= 0:
                continue
            current_price = s["price"]
            drop_pct = (cost_basis - current_price) / cost_basis * 100
            threshold = val  # val = 5 means "跌5%"
            if drop_pct >= threshold:
                dividend_yield = ""
                if pos.get("costYield"):
                    dividend_yield = f"，成本股息率 {pos['costYield']:.1f}%"
                results.append({
                    "stockCode": c, "stockName": name,
                    "message": f"🔴 跌破成本线 {threshold:.0f}%！当前价 ¥{current_price:.2f}，成本 ¥{cost_basis:.2f}，已跌 {drop_pct:.1f}%{dividend_yield}",
                    "priority": "high",
                })

        elif alert_type == "dividendDate":
            # 分红日预警：距离除权日 ≤ val 天
            for div in upcoming_dividends:
                if div.get("stockCode") != c:
                    continue
                div_date_str = div.get("date", "")
                try:
                    div_date = datetime.strptime(div_date_str[:10], "%Y-%m-%d")
                    days_until = (div_date - datetime.now()).days
                    if 0 <= days_until <= val:
                        results.append({
                            "stockCode": c, "stockName": name,
                            "message": f"🟢 {name} 即将分红！预计除权日 {div_date_str[:10]}（{days_until}天后），每股约 ¥{div.get('perShare', 0):.4f}",
                            "priority": "medium",
                        })
                except ValueError:
                    continue

        else:
            # 普通 field 告警
            current_val = get_field_value(s, field)
            if current_val is None:
                continue

            triggered = False
            if op == ">" and current_val > val: triggered = True
            elif op == ">=" and current_val >= val: triggered = True
            elif op == "<" and current_val < val: triggered = True
            elif op == "<=" and current_val <= val: triggered = True
            elif op == "==" and current_val == val: triggered = True

            if triggered:
                unit = "%" if field in ("changePercent", "dividendYield", "turnoverRate", "roe", "dividendPayoutRatio", "debtRatio") else ""
                results.append({
                    "stockCode": c, "stockName": name,
                    "message": f"⚠️ {label}：{name} 当前 {current_val}{unit}".strip(),
                    "priority": "medium",
                })

    return results


def main():
    # 读取预警规则
    rules = []
    if ALERTS_FILE.exists():
        try:
            raw = json.loads(ALERTS_FILE.read_text("utf-8"))
            rules = raw.get("data", [])
        except Exception:
            pass

    if not rules:
        print()  # Silent - no rules
        return

    # 读取持仓数据（用于成本价预警）
    portfolio = []
    portfolio_map = {}
    if PORTFOLIO_FILE.exists():
        try:
            portfolio = json.loads(PORTFOLIO_FILE.read_text("utf-8"))
            for p in portfolio:
                cost_yield = None
                if p.get("dividends") and p.get("totalCost", 0) > 0:
                    total_divs = sum(d.get("total", 0) for d in p.get("dividends", []))
                    real_cost = p["totalCost"] - total_divs
                    if real_cost > 0 and p.get("buyPrice", 0) > 0:
                        cost_yield = None  # 简化
                portfolio_map[p["stockCode"]] = p
        except Exception:
            pass

    # 收集所有需要检查的代码
    codes_to_check = set()
    for r in rules:
        alert_type = r.get("alertType", "field")
        if alert_type == "costBasis":
            codes_to_check.update(p["stockCode"] for p in portfolio)
        elif alert_type == "dividendDate":
            codes_to_check.update(p["stockCode"] for p in portfolio)
        elif r.get("stockCode"):
            codes_to_check.add(r["stockCode"])
        else:
            codes_to_check.add("noop_global")  # placeholder

    # 如果没有股票代码要检查，添加全局规则的代码
    has_global = any(not r.get("stockCode") and r.get("alertType", "field") == "field" for r in rules)
    if has_global:
        codes_to_check.discard("noop_global")
        # 对于全局规则，检查所有持仓 + 自选股
        for p in portfolio:
            codes_to_check.add(p["stockCode"])

    codes_to_check.discard("noop_global")
    codes_list = [c for c in codes_to_check if c]

    # 获取行情
    quotes = fetch_tencent(codes_list) if codes_list else {}

    # 获取分红日历
    upcoming_dividends = []
    if codes_list:
        try:
            resp = urllib.request.urlopen("http://localhost:3000/api/dividend-calendar?codes=" + ",".join(codes_list), timeout=15)
            div_data = json.loads(resp.read().decode("utf-8"))
            if div_data.get("success"):
                for item in div_data.get("data", []):
                    if item.get("events"):
                        upcoming_dividends.extend(item["events"])
        except Exception:
            pass

    # 检查所有规则
    all_alerts = []
    for r in rules:
        if not r.get("enabled", True):
            continue
        alerts = check_rule(r, quotes, portfolio_map, upcoming_dividends)
        all_alerts.extend(alerts)

    # 去重（同一股票同一消息只发一次）
    seen = set()
    unique_alerts = []
    for a in all_alerts:
        key = (a["stockCode"], a["message"][:30])
        if key not in seen:
            seen.add(key)
            unique_alerts.append(a)

    if not unique_alerts:
        return  # Silent - nothing triggered

    # 排序：先 High 再 Medium
    unique_alerts.sort(key=lambda a: 0 if a["priority"] == "high" else 1)

    now = datetime.now().strftime("%H:%M")
    lines = ["⚠️ **盘中预警**", f"检查时间: {now}", "", "---", ""]

    for a in unique_alerts:
        icon = "🔴" if a["priority"] == "high" else "⚡"
        lines.append(f"{icon} **{a['stockName']}**")
        lines.append(f"   {a['message']}")
        lines.append("")

    lines.append("---")
    lines.append("💡 打开看板查看更多: http://localhost:3000")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
