#!/usr/bin/env python3
"""
bond_data.py — 现金管理与股债性价比数据

为什么要它：格雷厄姆《聪明的投资者》第 8 章讲的是「股跌债涨」，
但那个结论成立的前提是利率还有下行空间。本模块把判断这件事需要的
三组数据固化下来，供 /api/cash-bond 与前端「现金与股债比」面板使用：

  1. 国债收益率（2Y / 10Y / 30Y）+ 所处历史分位  → 债券还值不值得买
  2. 国债逆回购实时利率（GC001 / GC007 / GC014） → 闲钱的真实无风险收益
  3. 债券 ETF 报价 + 久期                       → 不同久期的利率敏感度

输出：data/bond_cache.json
  同时把「10 年国债历史分位」算出来：分位越低＝越贵、下行空间越小。

用法：
  .venv/bin/python3 scripts/bond_data.py            # 生成/更新缓存
  .venv/bin/python3 scripts/bond_data.py --force    # 忽略缓存强制刷新
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from net_utils import setup_proxy_env

setup_proxy_env()

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "bond_cache.json"
CACHE_TTL_HOURS = 6

# 国债收益率序列（akshare bond_zh_us_rate 的列名）
YIELD_COLS = {
    "d2": "中国国债收益率2年",
    "d10": "中国国债收益率10年",
    "d30": "中国国债收益率30年",
}

# 国债逆回购：上交所 GC（10 万起）与深交所 R（1 千起）
REPO_LIST = {
    "sh204001": ("GC001", "上交所 1天"),
    "sh204007": ("GC007", "上交所 7天"),
    "sh204014": ("GC014", "上交所 14天"),
    "sz131810": ("R-001", "深交所 1天"),
}

# 债券类 ETF：久期为静态估算（×年期国债 ETF 跟踪久期 ≈ 指数久期），用于提示利率敏感度
BOND_ETFS = {
    "sh511990": ("华宝添益", "货币", 0.1, "场内货基，T+0 可当现金，收益 ≈ 逆回购"),
    "sh511880": ("银华日利", "货币", 0.1, "场内货基，T+0，规模大流动性好"),
    "sh511360": ("短融ETF", "短久期", 0.5, "短融债，利率敏感度极低，比货基略高"),
    "sh511010": ("国债ETF", "中久期", 4.2, "5 年期国债，久期约 4 年"),
    "sh511020": ("活跃国债ETF", "中久期", 4.5, "活跃券国债，流动性好"),
    "sh511260": ("十年国债ETF", "长久期", 8.0, "10 年期国债，久期约 8 年，利率上行 1% 约跌 8%"),
    "sh511090": ("30年国债ETF", "超长久期", 18.0, "30 年期国债，久期约 18 年，利率上行 1% 约跌 18%，是赌降息不是防守"),
    "sh511520": ("政金债券ETF", "中久期", 4.5, "国开/农发等政策性金融债，信用接近国债"),
    "sh511380": ("可转债ETF", "转债", 2.5, "转债本质是「债+股票期权」，跌起来跟股票一样，不是防守资产"),
}


def is_cache_fresh() -> bool:
    try:
        if not CACHE_FILE.exists():
            return False
        data = json.loads(CACHE_FILE.read_text())
        ts = datetime.fromisoformat(data["generated_at"])
        return (datetime.now() - ts).total_seconds() < CACHE_TTL_HOURS * 3600
    except Exception:
        return False


def pct_rank(series: list[float], value: float) -> float | None:
    """value 在 series 中的分位（%）：越低越贵（收益率低＝债券贵）"""
    vals = [v for v in series if v is not None]
    if not vals or value is None:
        return None
    cnt = sum(1 for v in vals if v <= value)
    return round(cnt / len(vals) * 100, 1)


def fetch_treasury_yields() -> dict:
    """国债收益率最新值 + 5 年/10 年历史分位"""
    out: dict = {}
    try:
        import akshare as ak

        df = ak.bond_zh_us_rate(start_date="20140101")
        dates = df["日期"].astype(str)
        for key, col in YIELD_COLS.items():
            if col not in df.columns:
                continue
            s = df[["日期", col]].dropna()
            if s.empty:
                continue
            latest = float(s[col].iloc[-1])
            latest_date = str(s["日期"].iloc[-1])[:10]
            series_all = [float(v) for v in s[col].tolist()]
            cutoff5 = (datetime.now() - __import__("datetime").timedelta(days=365 * 5)).strftime("%Y-%m-%d")
            series5 = [float(v) for d, v in zip(s["日期"].astype(str), s[col].tolist()) if d[:10] >= cutoff5]
            out[key] = {
                "value": round(latest, 2),
                "date": latest_date,
                "pct_5y": pct_rank(series5, latest),
                "pct_10y": pct_rank(
                    [float(v) for d, v in zip(s["日期"].astype(str), s[col].tolist())
                     if d[:10] >= (datetime.now() - __import__("datetime").timedelta(days=365 * 10)).strftime("%Y-%m-%d")],
                    latest),
                "min_5y": round(min(series5), 2) if series5 else None,
                "max_5y": round(max(series5), 2) if series5 else None,
                "points": len(series_all),
            }
        del dates
    except Exception as e:
        print(f"[warn] 国债收益率获取失败: {e}", file=sys.stderr)
    return out


def fetch_quotes(codes: list[str]) -> dict:
    """腾讯行情批量取现价与涨跌幅"""
    out: dict = {}
    try:
        txt = urllib.request.urlopen(
            urllib.request.Request(f"https://qt.gtimg.cn/q={','.join(codes)}",
                                   headers={"User-Agent": "Mozilla/5.0"}),
            timeout=15).read().decode("gbk")
        for line in txt.strip().split("\n"):
            if "=" not in line:
                continue
            key = line.split("=")[0].replace("v_", "").strip()
            f = line.split('"')[1].split("~") if '"' in line else []
            if len(f) < 33:
                continue
            try:
                out[key] = {"name": f[1], "price": float(f[3]), "change_pct": float(f[32])}
            except ValueError:
                continue
    except Exception as e:
        print(f"[warn] 行情获取失败: {e}", file=sys.stderr)
    return out


def fetch_repo_rates() -> dict:
    """国债逆回购实时年化利率（%），附 20 日均值用于判断「现在是不是好价」"""
    quotes = fetch_quotes(list(REPO_LIST.keys()))
    out: dict = {}
    for code, (name, desc) in REPO_LIST.items():
        q = quotes.get(code)
        if not q:
            continue
        out[name] = {"code": code, "desc": desc, "rate": round(q["price"], 3)}
    return out


def fetch_bond_etfs() -> list[dict]:
    quotes = fetch_quotes(list(BOND_ETFS.keys()))
    rows: list[dict] = []
    for code, (name, category, duration, note) in BOND_ETFS.items():
        q = quotes.get(code)
        if not q:
            continue
        rows.append({
            "code": code[2:],           # 去掉 sh/sz 前缀，前端按 6 位显示
            "market": code[:2],
            "name": name,
            "category": category,
            "duration": duration,
            "price": round(q["price"], 3),
            "changePct": round(q["change_pct"], 3),
            "note": note,
            # 利率上行 1% 时的大致价格影响（久期近似）
            "lossIfRateUp1pct": round(-duration, 1),
        })
    return rows


def main():
    force = "--force" in sys.argv
    if not force and is_cache_fresh():
        print(json.dumps({"success": True, "cached": True}, ensure_ascii=False))
        return

    data = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "yields": fetch_treasury_yields(),
        "repo": fetch_repo_rates(),
        "etfs": fetch_bond_etfs(),
    }
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))

    d10 = data["yields"].get("d10", {})
    print(json.dumps({
        "success": True,
        "cached": False,
        "d10": d10.get("value"),
        "d10_pct_5y": d10.get("pct_5y"),
        "repo": {k: v["rate"] for k, v in data["repo"].items()},
        "etfs": len(data["etfs"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
