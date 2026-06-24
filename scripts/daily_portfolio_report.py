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
    lines.append("")

    # ─── 📡 市场温度表 ─────────────────────────────────
    cache_file = os.path.join(os.path.dirname(__file__), "..", "cache", "index_valuations.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                valuation = json.load(f)
            indices = valuation.get("indices", [])
            lines.append("")
            lines.append("─── 📡 市场温度表 ───")
            lines.append("")
            for idx in indices:
                pct = idx.get("pct_5y", 50)
                if pct >= 80:
                    marker = "🔴"
                    verdict = "⚠️ 偏高"
                elif pct >= 60:
                    marker = "🟡"
                    verdict = "中等偏上"
                elif pct >= 40:
                    marker = "🔵"
                    verdict = "适中"
                elif pct >= 20:
                    marker = "🟢"
                    verdict = "偏低 ✅"
                else:
                    marker = "🟢"
                    verdict = "低估 ✅"

                pe = idx.get("pe", "?")
                lines.append(
                    f"{marker} **{idx['name']}** PE={pe} "
                    f"· 近5年{idx['pct_5y']:.0f}%分位 "
                    f"· {verdict}"
                )
            lines.append("")
            lines.append("> 数据来源：中证指数 · PE百分位越低越便宜")
            lines.append("")
        except Exception:
            pass

    # ─── 🎯 值得关注 ─────────────────────────────────
    lines.append("─── 🎯 值得关注 ───")
    lines.append("")

    # 从估值数据推荐对应的 ETF
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                valuation = json.load(f)
            candidates = [i for i in valuation.get("indices", [])
                          if i.get("pct_5y", 100) < 40]
            if candidates:
                lines.append("**📉 低估指数（百分位 < 40%），可关注相应 ETF：**")
                for idx in sorted(candidates, key=lambda x: x["pct_5y"]):
                    etf_code = idx.get("etf", "?")
                    lines.append(
                        f"- 🟢 **{idx['name']}** ({etf_code}) "
                        f"PE={idx['pe']} · {idx['pct_5y']:.0f}%分位 "
                        f"· {idx['desc']}"
                    )
                lines.append("")
        except Exception:
            pass

    # 从现有持仓挖高股息候选
    lines.append("**💰 高股息持仓（按成本股息率排序）：**")
    div_sorted = sorted(
        [i for i in advice_list if i.get("costYield", 0) > 1],
        key=lambda x: x.get("costYield", 0), reverse=True
    )[:5]
    if div_sorted:
        for item in div_sorted:
            lines.append(
                f"- {item['stockName']} ({item['stockCode']}) "
                f"成本股息率 **{item['costYield']:.1f}%** "
                f"· 现价股息率 {item.get('dividendYield', 0):.1f}%"
            )
    else:
        lines.append("- 暂无持仓数据")
    lines.append("")

    # ─── 💡 安全边际分析 ─────────────────────────────
    lines.append("─── 💡 安全边际分析 ───")
    lines.append("")
    for item in advice_list:
        name = item.get("stockName", item["stockCode"])
        code = item["stockCode"]
        price = item["currentPrice"]
        pe = item.get("pe")
        grid_levels = item.get("gridLevels", [])
        buy_levels = [g for g in grid_levels if g["type"] == "buy"]
        sell_levels = [g for g in grid_levels if g["type"] == "sell"]

        # PE 安全区间
        pe_note = ""
        if pe:
            if pe < 10:
                pe_note = "🔵 PE偏低"
            elif pe < 15:
                pe_note = "🟢 PE适中"
            elif pe < 25:
                pe_note = "🟡 PE偏高"
            else:
                pe_note = "🔴 PE高"

        # 下跌安全垫（到最近买入网格的距离）
        safety = ""
        if buy_levels:
            nearest_buy = max(buy_levels, key=lambda x: x["price"])
            if nearest_buy:
                drop_pct = (price - nearest_buy["price"]) / price * 100
                if drop_pct > 20:
                    safety = f"🔵 下行空间 {drop_pct:.0f}%（安全垫充足）"
                elif drop_pct > 10:
                    safety = f"🟢 下行空间 {drop_pct:.0f}%"
                elif drop_pct > 5:
                    safety = f"🟡 下行空间 {drop_pct:.0f}%（较薄）"
                else:
                    safety = f"🔴 下行空间仅 {drop_pct:.0f}%（风险较高）"

        if pe_note or safety:
            parts = []
            parts.append(f"- **{name}**")
            if pe_note:
                parts.append(pe_note)
            if safety:
                parts.append(safety)
            lines.append(" · ".join(parts))
    lines.append("")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
