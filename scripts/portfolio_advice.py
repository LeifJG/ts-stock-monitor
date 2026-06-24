#!/usr/bin/env python3
"""
portfolio_advice.py — 持仓操作建议分析引擎
用法: python3 portfolio_advice.py [--portfolio PORTFOLIO_JSON]
输出: JSON {advice: [{stockCode, stockName, ...}]}

策略说明:
  1. 网格交易 — 基于波动率设定买卖网格
  2. 做低成本 — 补仓/高抛低吸建议
  3. 股息价值 — 股息率与成本收益率评估
  4. 估值提示 — PE/PB 相对于行业和历史的位置
  5. 止盈止损 — 基于成本价的保护策略
"""

import sys
import json
import os
import math
from datetime import datetime

# 导入统一股息率模块
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from dividend_data import batch_fetch as batch_fetch_dividends, get_dividend_yield as calc_dividend_yield

os.environ["HTTP_PROXY"] = os.environ.get("http_proxy", "http://192.168.124.11:7890")
os.environ["HTTPS_PROXY"] = os.environ.get("https_proxy", "http://192.168.124.11:7890")

import urllib.request
import urllib.parse


# ─── 工具函数 ────────────────────────────────────────────────

def fetch_tencent_quotes(codes: list) -> dict:
    """从腾讯API获取实时行情"""
    items = []
    for c in codes:
        if len(c) == 5:
            items.append(f"hk{c}")
        elif c == "000001":
            items.append(f"sh{c}")
        elif c.startswith("6"):
            items.append(f"sh{c}")
        else:
            items.append(f"sz{c}")

    url = f"https://qt.gtimg.cn/q={','.join(items)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})

    try:
        proxy = urllib.request.ProxyHandler({
            'http': os.environ['HTTP_PROXY'],
            'https': os.environ['HTTPS_PROXY'],
        })
        opener = urllib.request.build_opener(proxy)
        resp = opener.open(req, timeout=15)
        data = resp.read()
        text = data.decode("gbk")
    except Exception:
        try:
            resp = urllib.request.urlopen(req, timeout=10)
            data = resp.read()
            text = data.decode("gbk")
        except Exception:
            return {}

    result = {}
    for line in text.strip().split("\n"):
        import re
        match = re.match(r'v_(hk|sh|sz|bj)(\d+)="(.+)"', line)
        if not match:
            continue
        code = match.group(2)
        fields = match.group(3).split("~")
        if len(fields) < 40:
            continue

        name = fields[1]
        price = float(fields[3]) if fields[3] else 0
        prev_close = float(fields[4]) if fields[4] else 0
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
        high = float(fields[33]) if fields[33] else price
        low = float(fields[34]) if fields[34] else price

        is_hk = match.group(1) == "hk"
        pe = float(fields[39]) if fields[39] else None
        pb = float(fields[46]) if not is_hk and fields[46] else None

        # ROE = PB / PE（杜邦最简形式）
        roe_val = None
        if pb and pe and pe > 0:
            calc_roe = (pb / pe) * 100
            if calc_roe < 100:
                roe_val = round(calc_roe, 2)
        # 腾讯直给的 ROE 做备选
        if roe_val is None and not is_hk and len(fields) > 66:
            try:
                roe_val = float(fields[66]) if fields[66] and float(fields[66]) > 0 else None
            except (ValueError, IndexError):
                pass

        # 股息率估算 - 用更现实的分红比例
        div_yield = None
        if pe and pe > 0:
            if is_hk:
                # 港股普遍分红比例较高
                payout = 0.45
            elif roe_val and roe_val > 20:
                # 高ROE成熟公司分红比例 40-50%
                payout = 0.45
            elif roe_val and roe_val > 15:
                payout = 0.42
            elif roe_val and roe_val > 10:
                payout = 0.40
            elif roe_val and roe_val > 5:
                payout = 0.35
            else:
                # 未知ROE时用偏保守但合理的估计
                payout = 0.35
            div_yield = round((payout / pe) * 100, 2)

        result[code] = {
            "name": name,
            "price": price,
            "prevClose": prev_close,
            "changePercent": round(change_pct, 2),
            "high": high,
            "low": low,
            "pe": pe,
            "roe": roe_val,
            "dividendYield": div_yield,
        }

    return result


def fetch_dividend_yields(codes: list) -> dict:
    """
    统一股息率数据源（复用 dividend_data 模块）
    从 cninfo 获取最近12个月的真实每股股利合计（TTM）
    返回: { code: {"dividend_per_share": float} | None }
    """
    raw = batch_fetch_dividends(codes)
    results = {}
    for code, entry in raw.items():
        if entry and entry.get("dividend_per_share"):
            results[code] = {"dividend_per_share": entry["dividend_per_share"]}
        else:
            results[code] = None
    return results


# ─── 分析策略 ────────────────────────────────────────────────

def analyze_position(pos: dict, quote: dict) -> dict:
    """对单只持仓生成操作建议"""
    code = pos["stockCode"]
    name = pos["stockName"]
    shares = pos["shares"]
    buy_price = pos["buyPrice"]
    total_cost = pos["totalCost"]
    buy_date = pos.get("buyDate", "")
    dividends = pos.get("dividends", [])

    current_price = quote.get("price", buy_price)
    div_yield = quote.get("dividendYield")
    pe = quote.get("pe")

    # 计算指标
    market_value = shares * current_price
    total_dividends = sum(d.get("total", 0) for d in dividends)
    real_cost = total_cost - total_dividends
    profit = market_value + total_dividends - total_cost
    profit_pct = (profit / total_cost * 100) if total_cost > 0 else 0

    # 成本股息率
    cost_yield = None
    if div_yield and real_cost > 0:
        annual_dps = (div_yield / 100) * current_price
        real_cost_per_share = real_cost / shares
        cost_yield = round((annual_dps / real_cost_per_share) * 100, 2)

    # 持仓天数
    days_held = 0
    if buy_date:
        try:
            bd = datetime.strptime(buy_date[:10], "%Y-%m-%d")
            days_held = (datetime.now() - bd).days
        except ValueError:
            pass

    # ── 策略 1: 网格交易建议 ──────────────────────────
    grid_volatility = max(abs(current_price - buy_price) / buy_price * 100, 3)
    grid_step = max(round(grid_volatility * 0.5, 1), 2)  # 网格步长

    grid_levels = []
    # 向下网格（买入区）
    for i in range(1, 5):
        level = current_price * (1 - grid_step * i / 100)
        if level > 0:
            grid_levels.append({
                "type": "buy",
                "price": round(level, 2),
                "drop_pct": round(-grid_step * i, 1),
                "label": f"↓{grid_step * i:.0f}% 补仓",
            })
    # 向上网格（卖出区）
    for i in range(1, 4):
        level = current_price * (1 + grid_step * i / 100)
        grid_levels.append({
            "type": "sell",
            "price": round(level, 2),
            "rise_pct": round(grid_step * i, 1),
            "label": f"↑{grid_step * i:.0f}% 减持",
        })

    # ── 策略 2: 做低成本建议 ──────────────────────────
    cost_diff = current_price - buy_price
    cost_diff_pct = (cost_diff / buy_price) * 100 if buy_price > 0 else 0

    cost_advice = []
    if cost_diff_pct < -10:
        cost_advice.append({
            "action": "补仓",
            "reason": f"现价低于成本价 {abs(cost_diff_pct):.1f}%，适合补仓摊低成本",
            "priority": "high",
        })
        # 建议补仓金额
        if total_cost > 0:
            add_shares = round(shares * 0.3)  # 建议补 30%
            cost_advice.append({
                "action": f"补 {add_shares} 股",
                "reason": f"当前持有 {shares} 股，建议补仓 30%（约 {add_shares} 股），降低持仓成本",
                "priority": "medium",
            })
    elif cost_diff_pct < -5:
        cost_advice.append({
            "action": "轻仓补入",
            "reason": f"小幅回撤 {abs(cost_diff_pct):.1f}%，可小批量补仓",
            "priority": "medium",
        })
    elif cost_diff_pct > 15:
        cost_advice.append({
            "action": "部分止盈",
            "reason": f"盈利 {cost_diff_pct:.1f}%，建议减持 20-30% 锁定利润",
            "priority": "high",
        })
        # 建议减持量
        sell_shares = round(shares * 0.25)
        cost_advice.append({
            "action": f"卖 {sell_shares} 股",
            "reason": f"卖出 {sell_shares} 股（25% 仓位），落袋为安，回调后再接回",
            "priority": "medium",
        })
    elif cost_diff_pct > 5:
        cost_advice.append({
            "action": "逢高减仓",
            "reason": f"小盈 {cost_diff_pct:.1f}%，可减持 10-15%",
            "priority": "low",
        })

    # ── 策略 3: 股息价值评估 ──────────────────────────
    div_advice = []
    if cost_yield and cost_yield > 8:
        div_advice.append({
            "action": "持有收息",
            "reason": f"成本股息率 {cost_yield:.1f}%，远超理财，建议长持吃分红",
            "priority": "high",
        })
    elif cost_yield and cost_yield > 5:
        div_advice.append({
            "action": "继续持有",
            "reason": f"成本股息率 {cost_yield:.1f}%，分红回报良好",
            "priority": "medium",
        })
    elif div_yield and div_yield > 4:
        div_advice.append({
            "action": "可加仓",
            "reason": f"当前股息率 {div_yield:.1f}% 较有吸引力，可考虑加仓",
            "priority": "medium",
        })
    elif div_yield and div_yield < 1:
        div_advice.append({
            "action": "注意风险",
            "reason": f"股息率仅 {div_yield:.1f}%，分红回报较低",
            "priority": "low",
        })

    # 分红再投资
    if total_dividends > 0 and current_price > 0:
        div_shares = total_dividends / current_price
        if div_shares >= 100:
            div_advice.append({
                "action": f"分红再投 {int(div_shares)} 股",
                "reason": f"累计分红 ¥{total_dividends:.0f}，可买入 {int(div_shares)} 股，增厚持仓",
                "priority": "medium",
            })

    # ── 策略 4: 估值提示 ──────────────────────────────
    val_advice = []
    if pe:
        if pe < 10:
            val_advice.append({
                "action": "估值偏低",
                "reason": f"PE={pe}，处于历史较低区间，可考虑加仓",
                "priority": "high",
            })
        elif pe > 30:
            val_advice.append({
                "action": "估值偏高",
                "reason": f"PE={pe}，估值较高，注意回调风险",
                "priority": "medium",
            })
        else:
            val_advice.append({
                "action": "估值合理",
                "reason": f"PE={pe}，处于合理区间",
                "priority": "info",
            })

    # 已持仓时间建议
    if days_held > 365:
        val_advice.append({
            "action": "长线标的",
            "reason": f"已持有 {days_held//365} 年 {days_held%365} 天，适合继续持有吃息",
            "priority": "info",
        })

    # ── 综合操作建议 ──────────────────────────────────
    operations = []
    all_high = [a for a in cost_advice + div_advice + val_advice if a.get("priority") == "high"]
    all_medium = [a for a in cost_advice + div_advice + val_advice if a.get("priority") == "medium"]

    for a in all_high[:2]:
        operations.append({
            "action": a["action"],
            "reason": a["reason"],
            "priority": "high",
        })
    for a in all_medium[:3]:
        operations.append({
            "action": a["action"],
            "reason": a["reason"],
            "priority": "medium",
        })

    # 如果没有建议
    if not operations:
        operations.append({
            "action": "继续持有",
            "reason": "当前价格合理，建议耐心持有等待分红",
            "priority": "info",
        })

    return {
        "stockCode": code,
        "stockName": name,
        "currentPrice": current_price,
        "buyPrice": buy_price,
        "costBasis": round(buy_price, 2),
        "shares": shares,
        "marketValue": round(market_value, 2),
        "totalProfit": round(profit, 2),
        "totalProfitPct": round(profit_pct, 2),
        "totalDividends": round(total_dividends, 2),
        "realCost": round(real_cost, 2),
        "costYield": cost_yield,
        "dividendYield": div_yield,
        "pe": pe,
        "daysHeld": days_held,
        "gridVolatility": round(grid_volatility, 1),
        "gridStep": grid_step,
        "gridLevels": grid_levels,
        "operations": operations,
        "adviceSummary": {
            "costAdvice": cost_advice,
            "dividendAdvice": div_advice,
            "valuationAdvice": val_advice,
        },
    }


def main():
    # 读取持仓数据
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--portfolio", default="", help="持仓JSON文件路径")
    parser.add_argument("--codes", default="", help="逗号分隔的股票代码，用于无持仓时测试")
    args = parser.parse_args()

    portfolio = []
    if args.portfolio:
        try:
            with open(args.portfolio, "r", encoding="utf-8") as f:
                portfolio = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    elif args.codes:
        codes = [c.strip() for c in args.codes.split(",") if c.strip()]
        portfolio = [{
            "stockCode": c,
            "stockName": c,
            "shares": 100,
            "buyPrice": 0,
            "totalCost": 0,
            "buyDate": "",
            "dividends": [],
        } for c in codes]
    elif not sys.stdin.isatty():
        try:
            portfolio = json.loads(sys.stdin.read())
        except json.JSONDecodeError:
            pass

    if not portfolio:
        print(json.dumps({"success": True, "advice": [], "note": "暂无持仓数据"}))
        return

    # 获取所有股票代码和当前行情
    codes = [p["stockCode"] for p in portfolio]
    quotes = fetch_tencent_quotes(codes)

    # 从 cninfo 获取真实每股股利（并行，严格可靠）
    # 策略：用真实每股股利算出现价股息率，再和 ROE 估值取大值
    try:
        em_divs = fetch_dividend_yields(codes)
        for code, div_data in em_divs.items():
            if div_data and div_data.get("dividend_per_share") is not None and code in quotes:
                dps = div_data["dividend_per_share"]
                price = quotes[code].get("price", 0)
                if price > 0:
                    real_dy = (dps / price) * 100
                else:
                    real_dy = 0
                est_dy = quotes[code].get("dividendYield", 0) or 0
                best_dy = round(max(real_dy, est_dy), 2)
                quotes[code]["dividendYield"] = best_dy
                quotes[code]["dividendPerShare"] = dps
    except Exception:
        pass  # cninfo 不可用时静默回退到估值

    # 逐个分析
    advice = []
    for pos in portfolio:
        code = pos["stockCode"]
        quote = quotes.get(code, {})
        # 更新名称
        if quote.get("name"):
            pos["stockName"] = quote["name"]
        result = analyze_position(pos, quote)
        advice.append(result)

    print(json.dumps({"success": True, "advice": advice, "generatedAt": datetime.now().isoformat()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
