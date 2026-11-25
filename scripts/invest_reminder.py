#!/usr/bin/env python3
"""
invest_reminder.py — 定投日微信提醒（供 systemd timer 调用）

设计原则：
    只在**定投日**输出内容，非定投日静默退出（exit 0 + 空输出）。
    为什么：定投提醒的价值在「今天要动手」，平时天天推「还不用买」就是噪音，
    推几天用户就会屏蔽掉，真到该买那天反而看不见。

输出分两种：
    有 buy 计划 → 给出金额与依据
    有 skip 计划 → 明确说「今天不买」+ 拦下原因（溢价超标 / 数据缺失）
                    —— 到日子没买是主动决策，必须让用户知道，而不是静默跳过

用法：
    python3 scripts/invest_reminder.py           # 打印（有内容才打印）
    python3 scripts/invest_reminder.py --force   # 无论是否定投日都输出（调试用）
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import investment_plans as ip


def build_message(force: bool = False) -> str:
    result = ip.run_all()
    plans = result.get("plans") or []
    due = [p for p in plans if p.get("isDueToday")]
    if not due and not force:
        return ""

    today = date.today().strftime("%Y-%m-%d")
    lines = [f"📅 定投提醒 · {today}", ""]

    if not due:
        lines.append("今天不是定投日。当前计划：")
        for p in plans:
            lines.append(f"· {p['name']}｜{p['frequency']}｜偏离 {p['deviationPct']}%")
        return "\n".join(lines)

    for p in due:
        mode_txt = "场内" if p["mode"] == "onsite" else "场外"
        lines.append(f"【{p['name']}】{mode_txt} {p['target'] or ''}")
        if p["action"] == "buy":
            lines.append(f"👉 建议买入 ¥{p['amount']:,}（{p['multiplier']} 份）")
        else:
            lines.append(f"⛔ {p['headline']}")
        for r in p.get("reasons", []):
            lines.append(f"  · {r}")
        lines.append("")

    buys = [p for p in due if p["action"] == "buy"]
    skips = [p for p in due if p["action"] == "skip"]
    if buys:
        total = sum(p["amount"] for p in buys)
        lines.append(f"合计买入：¥{total:,}")
    if skips:
        lines.append(f"本次跳过 {len(skips)} 个计划（原因见上）")

    lines.append("")
    lines.append("策略：均线偏离定投 + 溢价过滤 + 金字塔加码")
    lines.append("💡 仅供参考，不构成投资建议")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="非定投日也输出（调试）")
    args = ap.parse_args()

    msg = build_message(args.force)
    if not msg:
        return 0          # 非定投日：静默
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
