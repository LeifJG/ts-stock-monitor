#!/usr/bin/env python3
"""
daily_portfolio_report.py — 收盘后持仓报告生成
被定时任务调用，生成格式化操作建议报告
输出: Markdown 格式的报告文本
"""

import json
import urllib.request
import urllib.parse
import os
import sys
from datetime import datetime

# 本地 API 地址
BASE = os.environ.get("ADVICE_API_URL", "http://localhost:3000")

def fetch_json(path: str) -> dict:
    url = f"{BASE}{path}"
    try:
        resp = urllib.request.urlopen(url, timeout=15)
        return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"success": False, "error": str(e)}

def fmt(v, d=2):
    if v is None:
        return "--"
    return f"{v:.{d}f}"

def fmt_pct(v):
    if v is None:
        return "--"
    prefix = "+" if v > 0 else ""
    return f"{prefix}{v:.2f}%"

def main():
    # 获取操作建议
    result = fetch_json("/api/portfolio-advice?force=true")
    if not result.get("success"):
        print(f"❌ 获取分析失败: {result.get('error', '未知错误')}")
        sys.exit(1)

    advice_list = result.get("advice", [])
    if not advice_list:
        print("📋 收盘报告\n\n暂无持仓数据，无法生成操作建议。")
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = []
    lines.append(f"📊 **收盘持仓报告** — {now}")
    lines.append("")
    lines.append("---")
    lines.append("")

    total_profit = 0
    total_invested = 0
    total_dividends = 0
    total_market_value = 0

    for item in advice_list:
        name = item.get("stockName", item["stockCode"])
        code = item["stockCode"]
        price = item["currentPrice"]
        cost = item["costBasis"]
        pnl = item["totalProfit"]
        pnl_pct = item["totalProfitPct"]
        divs = item["totalDividends"]
        shares = item["shares"]
        cost_yield = item.get("costYield")
        div_yield = item.get("dividendYield")
        pe = item.get("pe")

        total_profit += pnl
        total_invested += cost * shares
        total_dividends += divs
        total_market_value += item.get("marketValue", 0)

        # 涨跌符号
        pnl_symbol = "📈" if pnl > 0 else "📉" if pnl < 0 else "➖"

        lines.append(f"### {pnl_symbol} {name} ({code})")
        lines.append(f"")
        lines.append(f"| 指标 | 数值 |")
        lines.append(f"|:---|:---:|")
        lines.append(f"| 现价 | ¥{fmt(price)} |")
        lines.append(f"| 成本价 | ¥{fmt(cost)} |")
        lines.append(f"| 持仓 | {shares} 股 |")
        lines.append(f"| 盈亏 | {fmt_pct(pnl_pct)}（¥{fmt(pnl)}）|")
        lines.append(f"| 累计分红 | ¥{fmt(divs)} |")
        lines.append(f"| PE | {fmt(pe)} |")
        lines.append(f"| 股息率 | {fmt(div_yield)}% |")
        if cost_yield:
            lines.append(f"| 成本股息率 | **{fmt(cost_yield)}%** |")
        lines.append("")

        # 操作建议
        ops = item.get("operations", [])
        if ops:
            lines.append("**📋 操作建议：**")
            for op in ops:
                priority = op.get("priority", "info")
                icon = "🔴" if priority == "high" else "🟡" if priority == "medium" else "🔵"
                lines.append(f"- {icon} **{op['action']}**: {op['reason']}")

        # 网格参考
        grid_levels = item.get("gridLevels", [])
        if grid_levels:
            buy_levels = [g for g in grid_levels if g["type"] == "buy"][:3]
            sell_levels = [g for g in grid_levels if g["type"] == "sell"][:3]
            if buy_levels:
                buy_str = " / ".join(f"¥{fmt(g['price'])}" for g in buy_levels)
                lines.append(f"")
                lines.append(f"📐 **网格买入**: {buy_str}")
            if sell_levels:
                sell_str = " / ".join(f"¥{fmt(g['price'])}" for g in sell_levels)
                lines.append(f"📐 **网格卖出**: {sell_str}")

        lines.append("")
        lines.append("---")
        lines.append("")

    # 汇总
    total_pnl_pct = (total_profit / total_invested * 100) if total_invested > 0 else 0
    lines.append("")
    lines.append("### 📊 组合汇总")
    lines.append("")
    lines.append(f"| 指标 | 数值 |")
    lines.append(f"|:---|:---:|")
    lines.append(f"| 总投入 | ¥{fmt(total_invested)} |")
    lines.append(f"| 当前市值 | ¥{fmt(total_market_value)} |")
    lines.append(f"| 总盈亏 | {fmt_pct(total_pnl_pct)}（¥{fmt(total_profit)}）|")
    lines.append(f"| 累计分红 | ¥{fmt(total_dividends)} |")
    lines.append(f"| 持仓数 | {len(advice_list)} 只 |")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("💡 *操作建议仅供参考，不构成投资建议*")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
