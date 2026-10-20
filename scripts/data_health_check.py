#!/usr/bin/env python3
"""
数据完整度体检：核对 data/ 和 cache/ 下所有缓存文件的覆盖度与新鲜度
------------------------------------------------------------------
输出每张缓存的：条目数与研究池(57)覆盖率、最后更新时间、过期判定
用途：2026-09 清缓存事件后核查数据损失面
"""
import json
import os
from datetime import datetime
from pathlib import Path

ROOT = Path(os.path.expanduser("~/ts-stock-monitor"))
DATA = ROOT / "data"
CACHE = ROOT / "cache"

# 研究池：以 portfolio.json + 各缓存并集为准，主口径用 moat_cache 的 57 只
pool = set(json.loads((DATA / "moat_cache.json").read_text()).keys())
print(f"研究池基准（moat_cache 覆盖）: {len(pool)} 只\n")

# 缓存清单：文件名 → (说明, TTL小时 or None=无过期)
SPECS = [
    ("moat_cache.json", "护城河量化", None),
    ("moat_llm_cache.json", "护城河叙述(LLM)", 90 * 24),
    ("fear_tech_cache.json", "恐慌技术指标", 7 * 24),
    ("valuation_cache.json", "估值分位", 24),
    ("dividend_yields.json", "股息率", 24 * 7),
    ("financials_cache.json", "财务数据", 24 * 30),
    ("shareholder_cache.json", "股东户数", 24 * 30),
    ("volatility_cache.json", "波动率", 24),
    ("advice_cache.json", "操作建议", 1 / 12),
    ("alerts.json", "预警规则", None),
    ("portfolio.json", "持仓数据(真实)", None),
]

print(f"{'缓存':<24}{'条目':>5}{'覆盖':>8}{'更新':>12}{'过期':>7}  备注")
print("-" * 82)


def mtime(f: Path) -> str:
    return datetime.fromtimestamp(f.stat().st_mtime).strftime("%m-%d %H:%M")


for fname, desc, ttl_h in SPECS:
    f = DATA / fname
    if not f.exists():
        print(f"{fname:<24}{'-':>5}{'-':>8}{'缺失':>12}{'':>7}  {desc}")
        continue
    try:
        obj = json.loads(f.read_text())
    except Exception as e:
        print(f"{fname:<24}{'解析失败':>5}{'':>8}{mtime(f):>12}{'':>7}  {e}")
        continue

    # 条目数：dict 看 key 数，list 看长度，其它算 1
    if isinstance(obj, dict):
        # volatility 这类有 meta 包裹的
        items = obj.get("items") if "items" in obj else obj
        n = len(items) if isinstance(items, (dict, list)) else 1
        codes = set(items.keys()) if isinstance(items, dict) else set()
    elif isinstance(obj, list):
        n = len(obj)
        codes = {r.get("code") for r in obj if isinstance(r, dict) and r.get("code")}
    else:
        n, codes = 1, set()

    cover = f"{len(codes & pool)}/{len(pool)}" if codes else "-"
    mt = datetime.fromtimestamp(f.stat().st_mtime)
    age_h = (datetime.now() - mt).total_seconds() / 3600
    expired = "⚠ 过期" if (ttl_h and age_h > ttl_h) else "ok"
    print(f"{fname:<24}{n:>5}{cover:>8}{mtime(f):>12}{expired:>7}  {desc}")

print("\n--- cache/ 目录 ---")
for f in sorted(CACHE.glob("*.json")):
    try:
        obj = json.loads(f.read_text())
        n = len(obj) if isinstance(obj, (dict, list)) else 1
    except Exception:
        n = "?"
    print(f"{f.name:<24}{str(n):>5}{'':>8}{mtime(f):>12}{'':>7}")

print("\n--- 研究池里缺数据的 code ---")
for fname in ["moat_llm_cache.json", "fear_tech_cache.json", "valuation_cache.json",
              "financials_cache.json", "shareholder_cache.json", "dividend_yields.json"]:
    f = DATA / fname
    if not f.exists():
        continue
    obj = json.loads(f.read_text())
    items = obj.get("items") if isinstance(obj.get("items") if isinstance(obj, dict) else None, dict) else obj
    if isinstance(items, dict):
        miss = sorted(pool - set(items.keys()))
        if miss:
            print(f"  {fname}: 缺 {len(miss)} 只 → {','.join(miss[:12])}{'...' if len(miss) > 12 else ''}")
