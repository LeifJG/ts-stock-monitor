#!/usr/bin/env python3
"""
moat_data.py — 护城河量化分析引擎

方法论：Morningstar 经济护城河框架的量化近似
  - 核心证据：ROIC 相对资金成本（近似 8%）的超额收益持续性
  - 五维度评分（0-100）：盈利持续性 30 / 定价权 25 / 财务稳健 20 /
    股东回报 15 / 现金创造 10
  - 评级映射：>=75 Wide（宽护城河）/ >=60 Narrow（窄护城河）/ 其余 None

数据源（均为已有管道）：
  - stock_financial_abstract（东财摘要）：ROIC 年度序列（2004起）、毛利率序列
  - stock_financial_hk_analysis_indicator_em（港股 HKF10）：ROIC/毛利率年度序列
  - dividend_data.batch_fetch：分红率（payout ratio）
  - financials_cache.json：负债率、OCF/净利 兜底

输出：data/moat_cache.json
  { code: { score, rating, ratingLabel, dims: {...}, series: {...}, facts: {...} } }
  叙述层（LLM 描述）由 moat_narrative.py 单独生成，读写 data/moat_llm_cache.json
"""

import os
import re
import sys
import json
import math
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from net_utils import setup_proxy_env

setup_proxy_env()

import akshare as ak

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "moat_cache.json"
FIN_CACHE = Path(__file__).resolve().parent.parent / "data" / "financials_cache.json"
VAL_CACHE = Path(__file__).resolve().parent.parent / "data" / "valuation_cache.json"

HK_CODE_RE = re.compile(r"^\d{5}$")
WACC_APPROX = 8.0  # 资金成本近似（国内无风险收益 2-3% + 股权风险溢价），Morningstar 口径的简化

# 估值缓存（含 PE），用于反推 EPS → 分红率 payout；1.6MB 级文件，进程内只读一次
_VAL_MEM: dict = {}
_VAL_LOADED = False


def _load_val_cache() -> dict:
    global _VAL_MEM, _VAL_LOADED
    if not _VAL_LOADED:
        try:
            _VAL_MEM = json.loads(VAL_CACHE.read_text())
        except Exception:
            _VAL_MEM = {}
        _VAL_LOADED = True
    return _VAL_MEM


def get_pe(code: str) -> float | None:
    """从估值缓存取当前 PE（TTM），拿不到返回 None"""
    return _f((_load_val_cache().get(code) or {}).get("pe_ttm"))


def _is_hk(code: str) -> bool:
    return bool(HK_CODE_RE.match(code))


def _f(v) -> float | None:
    """安全转 float，nan/None/空串 → None"""
    if v is None:
        return None
    s = str(v)
    if s in ("nan", "None", "", "--"):
        return None
    try:
        x = float(s)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


# ─── 历史序列抓取 ────────────────────────────────────────────

def fetch_series_hk(code: str) -> dict | None:
    """港股：HKF10 年度指标 → ROIC/毛利率/负债率 序列"""
    df = None
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            df = ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="年度")
            break
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    if df is None or getattr(df, "empty", True):
        if last_err:
            print(f"[warn] {code}(HK): 财务接口失败: {last_err}", file=sys.stderr)
        return None
    try:
        df = df.sort_values("REPORT_DATE").reset_index(drop=True)
        series: dict[str, list[tuple[str, float]]] = {"roic": [], "grossMargin": [], "debtRatio": []}
        for _, row in df.iterrows():
            date = str(row.get("REPORT_DATE", ""))[:10]
            for key, col in (("roic", "ROIC_YEARLY"), ("grossMargin", "GROSS_PROFIT_RATIO"),
                             ("debtRatio", "DEBT_ASSET_RATIO")):
                v = _f(row.get(col))
                if v is not None and -100 < v < 200:
                    series[key].append((date, round(v, 2)))
        return series
    except Exception as e:
        print(f"[warn] {code}(HK): 解析失败: {e}", file=sys.stderr)
        return None


def fetch_series_cn(code: str) -> dict | None:
    """A股：东财摘要 → ROIC/毛利率序列（指标为行、报告期为列）"""
    try:
        df = ak.stock_financial_abstract(symbol=code)
    except Exception as e:
        print(f"[warn] {code}: 东财摘要失败: {e}", file=sys.stderr)
        return None
    try:
        # 年报列（1231 结尾），升序
        cols = sorted([c for c in df.columns if "1231" in str(c)])[-12:]
        if not cols:
            return None
        series: dict[str, list[tuple[str, float]]] = {"roic": [], "grossMargin": [], "debtRatio": []}
        # ROIC 优先「投入资本回报率」；银行/保险/券商无此行时回退「净资产收益率_平均」
        # （金融业高杠杆下 ROE 是更贴切的资本回报口径；6000xx 前缀会误伤 600066，故不做前缀预判）
        # 注意：有的票「投入资本回报率」行存在但值全 NaN → 须校验有效值再选中，否则回退
        roic_labels = ["投入资本回报率", "净资产收益率_平均"]
        labels = {"grossMargin": "毛利率", "debtRatio": "资产负债率"}
        for label in roic_labels:
            row = df[df["指标"].astype(str).str.contains(label, na=False)]
            if row.empty:
                continue
            r = row.iloc[0]
            good = [c for c in cols if _f(r.get(c)) is not None]
            if good:
                labels["roic"] = label
                break
        col_map = labels
        for key, label in col_map.items():
            row = df[df["指标"].astype(str).str.contains(label, na=False)]
            if row.empty:
                continue
            r = row.iloc[0]
            for c in cols:
                v = _f(r.get(c))
                if v is not None and -100 < v < 200:
                    series[key].append((str(c)[:4], round(v, 2)))
        return series if any(series.values()) else None
    except Exception as e:
        print(f"[warn] {code}: 解析失败: {e}", file=sys.stderr)
        return None


# ─── 分红率 ──────────────────────────────────────────────────

def fetch_payout(code: str, shares: int | None = None) -> dict | None:
    """近 3 个年度的分红率（payout = 分红总额 / 归母净利），用 dividend_data 模块"""
    try:
        from dividend_data import batch_fetch
        raw = batch_fetch([code])
        entry = raw.get(code)
        if not entry:
            return None
        # dividend_data 返回 dividend_per_share（近12月每股股利合计）
        # 分红率需要 EPS：从东财摘要拿
        return {"dividendPerShare": entry.get("dividend_per_share")}
    except Exception:
        return None


# ─── 五维度评分 ──────────────────────────────────────────────

def score_roic_persistence(roic_series: list[tuple[str, float]]) -> tuple[float, dict]:
    """维度1 盈利持续性（30分）：近5年 ROIC 均值、稳定性、超 WACC 年数"""
    if len(roic_series) < 3:
        return 0.0, {"years_above_wacc": None, "roic_avg5": None, "roic_stable": None}
    vals = [v for _, v in roic_series[-5:]]
    avg = sum(vals) / len(vals)
    # 稳定性：标准差 < 5pp 视为稳定
    mean = avg
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    std = math.sqrt(var)
    stable = std < 5.0
    # 超过 WACC 的年数（近5年中）
    years_above = sum(1 for v in vals if v > WACC_APPROX)

    score = 0.0
    # ROIC 水平（18分）：均值 8/12/18/25 分档
    if avg >= 25:
        score += 18
    elif avg >= 18:
        score += 15
    elif avg >= 12:
        score += 11
    elif avg >= 8:
        score += 6
    # 稳定性（6分）
    if stable:
        score += 6
    elif std < 8.0:
        score += 3
    # 持续性（6分）：全序列超 WACC 年数（体现长期壁垒）
    all_above = sum(1 for _, v in roic_series if v > WACC_APPROX)
    if all_above >= 10:
        score += 6
    elif all_above >= 5:
        score += 4
    elif all_above >= 3:
        score += 2

    return score, {"years_above_wacc": years_above, "roic_avg5": round(avg, 1),
                   "roic_stable": stable, "roic_years_total_above": all_above,
                   "roic_std": round(std, 1)}


def score_pricing_power(gm_series: list[tuple[str, float]], roic_series: list[tuple[str, float]]) -> tuple[float, dict]:
    """维度2 定价权（25分）：毛利率绝对水平 + 稳定性/趋势"""
    if not gm_series:
        return 0.0, {}
    vals = [v for _, v in gm_series]
    latest = vals[-1]
    window = vals[-5:]
    avg = sum(window) / len(window)
    std = math.sqrt(sum((v - avg) ** 2 for v in window) / len(window))
    trend = vals[-1] - vals[0] if len(vals) >= 2 else 0.0

    score = 0.0
    # 水平（18分）：行业差异大，取宽档
    if avg >= 60:
        score += 18
    elif avg >= 40:
        score += 14
    elif avg >= 25:
        score += 10
    elif avg >= 15:
        score += 5
    # 稳定（7分）：毛利率波动小 = 有定价纪律
    if std < 2.0:
        score += 7
    elif std < 4.0:
        score += 4
    elif trend >= 0:
        score += 2

    return score, {"gm_avg5": round(avg, 1), "gm_latest": latest, "gm_std": round(std, 1),
                   "gm_trend": round(trend, 1)}


def score_financial_strength(debt_ratio: float | None, ocf_np: float | None) -> tuple[float, dict]:
    """维度3 财务稳健（20分）：负债率 + OCF/净利"""
    score = 0.0
    facts = {}
    if debt_ratio is not None:
        facts["debtRatio"] = debt_ratio
        # 金融股（负债率 90+）单独放宽——吸收存款属商业模式，非风险
        if debt_ratio <= 40:
            score += 12
        elif debt_ratio <= 60:
            score += 9
        elif debt_ratio <= 75:
            score += 5
        elif debt_ratio <= 92:
            score += 4  # 金融股常态区间给基础分
    if ocf_np is not None:
        facts["ocfToNetProfit"] = ocf_np
        if ocf_np >= 1.0:
            score += 8
        elif ocf_np >= 0.8:
            score += 5
        elif ocf_np >= 0.5:
            score += 2
    return score, facts


def score_shareholder_return(dividend_per_share: float | None, price: float | None,
                             payout_ratio: float | None) -> tuple[float, dict]:
    """维度4 股东回报（15分）：分红率优先，股息率辅助"""
    score = 0.0
    facts = {}
    if payout_ratio is not None:
        facts["payoutRatio"] = payout_ratio
        if payout_ratio >= 60:
            score += 10
        elif payout_ratio >= 40:
            score += 8
        elif payout_ratio >= 25:
            score += 4
    if dividend_per_share and price and price > 0:
        dy = round(dividend_per_share / price * 100, 2)
        facts["dividendYield"] = dy
        if dy >= 5:
            score += 5
        elif dy >= 3:
            score += 3
    return score, facts


def score_cash_creation(ocf_np: float | None, roic_series: list[tuple[str, float]]) -> tuple[float, dict]:
    """维度5 现金创造（10分）：OCF/净利

    历史问题：门槛 ≥1.2 就给满分，全池中位数正好 10 分 → 人人满分、没有区分度。
    现改为 ≥1.5 满分，1.2–1.5 给 7，1.0–1.2 给 5，让「利润含金量」真正拉开差距。
    """
    if ocf_np is None:
        return 0.0, {}
    score = 0.0
    if ocf_np >= 1.5:
        score = 10
    elif ocf_np >= 1.2:
        score = 7
    elif ocf_np >= 1.0:
        score = 5
    elif ocf_np >= 0.7:
        score = 3
    return score, {}


# ─── 主分析 ──────────────────────────────────────────────────

def analyze_one(code: str, price: float | None = None) -> dict | None:
    """单只股票护城河分析：抓序列 → 五维度 → 评级"""
    series = fetch_series_hk(code) if _is_hk(code) else fetch_series_cn(code)
    if not series:
        return None

    # 兜底字段（financials_cache：负债率/OCF比最新值）
    fin_fallback = {}
    try:
        fin = json.loads(FIN_CACHE.read_text())
        fin_fallback = fin.get(code, {})
    except Exception:
        pass

    roic_s = series.get("roic", [])
    gm_s = series.get("grossMargin", [])
    debt_latest = (series.get("debtRatio") or [None])[-1]
    debt = debt_latest[1] if debt_latest else _f(fin_fallback.get("debtRatio"))
    ocf_np = _f(fin_fallback.get("ocfToNetProfit"))

    s1, f1 = score_roic_persistence(roic_s)
    s2, f2 = score_pricing_power(gm_s, roic_s)
    s3, f3 = score_financial_strength(debt, ocf_np)
    s5, _ = score_cash_creation(ocf_np, roic_s)

    # 维度4 股东回报：分红率 payout 优先（15 分制的主体），股息率辅助
    # 历史 bug：这里第三个参数硬编码 None，导致 payout≥60 的 10 分永远拿不到，
    # 该维度实际满分只有 5/15 → 全池都被系统性扣掉最多 10 分。
    # 现用 EPS = 现价 / PE(TTM) 反推 payout = 每股分红 / EPS。
    div_info = None
    try:
        from dividend_data import batch_fetch
        raw = batch_fetch([code])
        entry = raw.get(code)
        dps = entry.get("dividend_per_share") if entry else None
        payout = None
        if dps and price and price > 0:
            pe_now = get_pe(code)
            if pe_now and pe_now > 0:
                eps = price / pe_now
                if eps > 0:
                    payout = round(dps / eps * 100, 2)
                    # 越界视为数据异常（分红超净利润 2 倍 / 负值），不参与评分
                    if payout <= 0 or payout > 200:
                        payout = None
            s4, f4 = score_shareholder_return(dps, price, payout)
        else:
            s4, f4 = 0.0, {}
        div_info = f4
    except Exception:
        s4, f4 = 0.0, {}

    total = s1 + s2 + s3 + s4 + s5
    if total <= 0:
        return None

    if total >= 75:
        rating, label = "wide", "宽护城河"
    elif total >= 60:
        rating, label = "narrow", "窄护城河"
    else:
        rating, label = "none", "无护城河"

    return {
        "code": code,
        "score": round(total, 1),
        "rating": rating,
        "ratingLabel": label,
        "dims": {
            "盈利持续性": {"score": round(s1, 1), "max": 30, **f1},
            "定价权": {"score": round(s2, 1), "max": 25, **f2},
            "财务稳健": {"score": round(s3, 1), "max": 20, **f3},
            "股东回报": {"score": round(s4, 1), "max": 15, **f4},
            "现金创造": {"score": round(s5, 1), "max": 10},
        },
        "series": {
            "roic": roic_s[-10:],
            "grossMargin": gm_s[-10:],
        },
        "facts": {**(f1), **(f2 or {}), **(f3 or {}), **(f4 or {})},
        "waccApprox": WACC_APPROX,
    }


def default_codes() -> list[str]:
    """默认清单 = 持仓 ∪ 财务缓存全量"""
    codes: list[str] = []
    pf_file = Path(__file__).resolve().parent.parent / "data" / "portfolio.json"
    try:
        pf = json.loads(pf_file.read_text())
        pf_list = pf if isinstance(pf, list) else (pf.get("positions") or pf.get("data") or [])
        for item in pf_list:
            c = str(item.get("stockCode") or item.get("code") or "").strip()
            if c:
                codes.append(c)
    except Exception:
        pass
    try:
        fin = json.loads(FIN_CACHE.read_text())
        for c in fin.keys():
            if c not in codes:
                codes.append(c)
    except Exception:
        pass
    return codes


def main():
    codes = sys.argv[1:] if len(sys.argv) > 1 else default_codes()
    print(f"护城河分析 {len(codes)} 只: {codes[:8]}{'...' if len(codes) > 8 else ''}")

    # 现价（股息率计算用）：腾讯行情批量
    prices: dict[str, float] = {}
    try:
        import urllib.request
        items = []
        for c in codes:
            items.append(("hk" if _is_hk(c) else ("sh" if c.startswith(("6", "9")) else "sz")) + c)
        txt = urllib.request.urlopen(
            urllib.request.Request(f"https://qt.gtimg.cn/q={','.join(items)}",
                                   headers={"User-Agent": "Mozilla/5.0"}), timeout=10).read().decode("gbk")
        for line in txt.strip().split("\n"):
            m = re.match(r'v_(?:hk|sh|sz|bj)(\d+)="(.+)"', line)
            if m:
                fields = m.group(2).split("~")
                if len(fields) > 3 and fields[3]:
                    prices[m.group(1)] = float(fields[3])
    except Exception as e:
        print(f"[warn] 行情获取失败（股息率维度降级）: {e}", file=sys.stderr)

    result: dict[str, dict] = {}
    ok = 0
    for i, code in enumerate(codes):
        try:
            r = analyze_one(code, price=prices.get(code))
            if r:
                result[code] = r
                ok += 1
                print(f"  ✓ {code}: {r['score']} {r['ratingLabel']}")
            else:
                print(f"  ✗ {code}: 数据不足")
        except Exception as e:
            print(f"  ✗ {code}: {e}")
        if (i + 1) % 10 == 0:
            time.sleep(1)  # 限速礼貌

    # 合并旧缓存
    old = {}
    if CACHE_FILE.exists():
        try:
            old = json.loads(CACHE_FILE.read_text())
        except Exception:
            pass
    old.update(result)
    CACHE_FILE.write_text(json.dumps(old, ensure_ascii=False, indent=2))
    print(json.dumps({"success": ok > 0, "ok": ok, "total": len(codes)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
