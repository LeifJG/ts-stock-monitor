#!/usr/bin/env python3
"""
scripts/leak_guard.py — 提交前泄露自查
========================================
背景：本项目曾在一次提交里把真实持仓备份（股数/成本价）误推到了公开仓库。
本脚本在提交前扫一遍「即将入库的文件」，发现真实持仓特征就拦下来。

真实持仓的唯一权威来源：data/portfolio.json（gitignored，永不入库）

用法：
  backend/.venv/bin/python3 scripts/leak_guard.py          # 扫暂存区（git 钩子用）
  backend/.venv/bin/python3 scripts/leak_guard.py --all    # 扫全部已跟踪文件
  backend/.venv/bin/python3 scripts/leak_guard.py --install  # 装成 pre-commit 钩子

判定规则（任一命中即拦截）：
  1. 文件路径命中禁止名单（data/、backup/、ts_calc_output_real.json 等）
  2. 文件内容里同时出现真实持仓的「股票代码」和「该代码的股数」
  3. 文件内容里出现真实持仓的「股票代码」和「该代码的成本价」
"""
import json
import os
import re
import stat
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTFOLIO = os.path.join(ROOT, "data", "portfolio.json")

# 永远不许入库的路径特征
FORBIDDEN_PATHS = [
    "data/portfolio.json",
    "backup/",
    "ts_calc_output_real.json",
    "cache/push_target",
    "auth.json",
    ".env",
]

# 单文件扫描上限（大文件跳过，避免拖慢提交）
MAX_SIZE = 3_000_000


def load_signatures() -> list[tuple[str, float, float]]:
    """从真实持仓里提取 (代码, 股数, 成本价) 签名；没有该文件就返回空（无签名=不拦内容）"""
    if not os.path.exists(PORTFOLIO):
        return []
    try:
        raw = json.load(open(PORTFOLIO, encoding="utf-8"))
    except Exception:
        return []
    sigs = []
    for p in raw if isinstance(raw, list) else []:
        code = str(p.get("code") or p.get("stockCode") or "").strip()
        shares = p.get("shares")
        cost = p.get("cost") or p.get("buyPrice")
        if code:
            sigs.append((code, float(shares or 0), float(cost or 0)))
    return sigs


def staged_files() -> list[str]:
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        cwd=ROOT, capture_output=True, text=True
    ).stdout
    return [f for f in out.splitlines() if f.strip()]


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout
    return [f for f in out.splitlines() if f.strip()]


def check(files: list[str], sigs) -> list[str]:
    problems: list[str] = []

    for f in files:
        if any(f == p or f.startswith(p) for p in FORBIDDEN_PATHS):
            problems.append(f"{f}  ← 路径命中禁止名单（持仓/凭证类文件不许入库）")
            continue

        path = os.path.join(ROOT, f)
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_SIZE:
            continue
        try:
            txt = open(path, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue

        for code, shares, cost in sigs:
            if f'"{code}"' not in txt and f"'{code}'" not in txt:
                continue
            # 同一文件里出现该代码 + 该代码的真实股数
            if shares and re.search(rf'(shares|数量)\D{{0,6}}{int(shares)}\b', txt):
                problems.append(f"{f}  ← 含真实持仓 {code} 的股数 {int(shares)}")
                break
            # 同一文件里出现该代码 + 该代码的真实成本价
            if cost and re.search(rf'(cost|price|buyPrice|成本|均价)\D{{0,6}}{re.escape(str(cost))}', txt):
                problems.append(f"{f}  ← 含真实持仓 {code} 的成本价 {cost}")
                break
    return problems


def install_hook() -> int:
    hook = os.path.join(ROOT, ".git", "hooks", "pre-commit")
    os.makedirs(os.path.dirname(hook), exist_ok=True)
    body = (
        "#!/bin/sh\n"
        "# 自动生成：真实持仓泄露自查（scripts/leak_guard.py）\n"
        'exec "$(git rev-parse --show-toplevel)/backend/.venv/bin/python3" '
        '"$(git rev-parse --show-toplevel)/scripts/leak_guard.py"\n'
    )
    open(hook, "w", encoding="utf-8").write(body)
    os.chmod(hook, os.stat(hook).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    print(f"已安装 pre-commit 钩子：{hook}")
    return 0


def main() -> int:
    if "--install" in sys.argv:
        return install_hook()

    scan_all = "--all" in sys.argv
    files = tracked_files() if scan_all else staged_files()
    scope = "全部已跟踪文件" if scan_all else "暂存区"

    if not files:
        print(f"[leak_guard] {scope} 没有文件，跳过")
        return 0

    sigs = load_signatures()
    if not sigs:
        print("[leak_guard] ⚠ 读不到 data/portfolio.json，只做路径检查")
    problems = check(files, sigs)

    if problems:
        print(f"[leak_guard] ❌ 拦截：{len(problems)} 个文件疑似含真实数据\n")
        for p in problems:
            print("   ", p)
        print("\n修复方式：把数值改成虚构的，或把文件移出仓库（并加进 .gitignore）")
        return 1

    print(f"[leak_guard] ✅ {len(files)} 个文件（{scope}）通过自查")
    return 0


if __name__ == "__main__":
    sys.exit(main())
