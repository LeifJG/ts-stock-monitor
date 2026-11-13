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

from etf_index_map import etf_underlying_index, is_etf_code
from net_utils import setup_proxy_env

setup_proxy_env()

import urllib.request
import urllib.parse


# ─── 工具函数 ────────────────────────────────────────────────

def to_tencent_symbol(code: str) -> str:
    """代码 → 腾讯行情符号。

    坑：ETF 5xxxxx 是**沪市**（588080=科创50ETF），原来按"非 6 开头就是深市"
    拼成 sz588080，腾讯根本不认 → 该标的拿不到行情 → 分析静默用成本价当现价，
    盈亏显示 0%，操作建议全部失效。
    """
    c = (code or "").strip()
    if len(c) == 5:                      # 港股
        return f"hk{c}"
    if c.startswith(("6", "9", "5")):    # 沪市股票 / B股 / ETF与LOF
        return f"sh{c}"
    if c.startswith(("15", "16", "18")):  # 深市 ETF / LOF
        return f"sz{c}"
    if c.startswith("1"):                # 沪市可转债等 11xxxx
        return f"sh{c}"
    if c.startswith(("4", "8")):         # 北交所
        return f"bj{c}"
    return f"sz{c}"


def fetch_tencent_quotes(codes: list) -> dict:
    """从腾讯API获取实时行情"""
    items = [to_tencent_symbol(c) for c in codes]

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
            # 这里是 payout÷PE 的**估算值**；main() 拿到 cninfo 真实每股分红后会覆盖为 cninfo
            "dividendYieldSource": "estimate" if div_yield else "none",
        }

    return result


def pick_dividend_yield(dps: float | None, price: float, est_dy: float | None) -> tuple[float, str]:
    """股息率口径：**真实每股分红优先，估算仅在真实数据缺失时兜底**。

    旧实现是 max(real_dy, est_dy)，本意"保守取大"，但股息率取大等于把
    用户实际能拿到的现金回报抬高：600036 真实 4.74% 被估成 5.66%，
    成本股息率从 9.04% 虚高到 10.8%，日报表格与建议文案对不上。

    返回 (股息率 %, 来源)：来源 = cninfo（真实每股分红）/ estimate（payout÷PE 估算）/ none
    """
    if dps is not None and dps == 0:
        # dps == 0 是「确认无分红」（港股 empty_hk），不能再用估算值糊上去
        return 0.0, "none"
    if dps and dps > 0 and price > 0:
        return round(dps / price * 100, 2), "cninfo"
    if est_dy and est_dy > 0:
        return round(est_dy, 2), "estimate"
    return 0.0, "none"


def fetch_dividend_yields(codes: list) -> dict:
    """
    统一股息率数据源（复用 dividend_data 模块）
    从 cninfo 获取最近12个月的真实每股股利合计（TTM）
    返回: { code: {"dividend_per_share": float} | None }
    """
    raw = batch_fetch_dividends(codes)
    results = {}
    for code, entry in raw.items():
        if entry and entry.get("dividend_per_share") is not None:
            results[code] = {
                "dividend_per_share": entry["dividend_per_share"],
                "source": entry.get("source"),
            }
        else:
            results[code] = None
    return results


# ─── 分析策略 ────────────────────────────────────────────────

def load_valuation_cache() -> dict:
    """估值分位缓存（valuation_data.py 维护，含港股，每日 15:05 刷新）"""
    try:
        cache_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "valuation_cache.json")
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ─── 卖出规则阈值（口径可调，改这里就够）────────────────────
# 设计原则（价值派口径）：卖出由「估值」驱动；成本收益率只衡量仓位与个人收益，
# 不作为独立触发条件 —— 成本价是沉没成本锚，跟股票现在贵不贵无关。
SELL_PCT_HIGH = 70.0          # 估值分位 ≥70% → 偏贵
SELL_PCT_VERY_HIGH = 85.0     # 估值分位 ≥85% → 很贵，可脱离浮盈单独提示减仓
SELL_PCT_NEUTRAL = 50.0       # 估值分位 <50% → 判定为「不贵」，即使现价超中位数也不卖
SELL_PROFIT_CONFIRM = 15.0    # 浮盈 ≥15% 仅作「确认/加码」条件，不是触发条件
SELL_PROFIT_MIN = 5.0         # 估值极贵时的最小浮盈门槛（<5% 只提示不动手）
SELL_ABOVE_FAIR_PREMIUM = 5.0  # 现价需高于合理估值 5% 以上才算「贵过历史中位数」
FAIR_PE_RATIO_MIN = 0.5       # PE 中位数/当前 PE 越界 → 中位数锚失效（盈利暴增/断崖）
FAIR_PE_RATIO_MAX = 2.0

# 说明：fair_value 用 valuation_cache 的 5 年倍数中位数反推（纯数据锚，不做盈利预测），
#      并夹在 0.5x–2x 现价之间，避免中位数断代造成的荒谬值。


def estimate_fair_value(val: dict | None, price: float, pe: float | None) -> tuple[float | None, str | None]:
    """用历史倍数中位数反推合理估值。

    盈利股：price × (PE 5年中位数 / 当前 PE)
    亏损股：price × (PB 5年中位数 / 当前 PB)，比值越界（>3x 或 <1/3）视为中位数不可比，放弃
    返回 (合理估值, 锚说明)；数据不足返回 (None, None)
    """
    if not price or price <= 0:
        return None, None
    v = val or {}
    pe_med = v.get("pe_median_5y")
    pb_med = v.get("pb_median_5y")
    pb_now = v.get("pb")
    fv, basis = None, None
    if pe is not None and pe > 0 and pe_med and pe_med > 0:
        ratio = pe_med / pe
        # 盈利暴增会让当前 PE 远低于中位数 → 中位数锚失效，改走 PB
        if FAIR_PE_RATIO_MIN <= ratio <= FAIR_PE_RATIO_MAX:
            fv, basis = price * ratio, "PE 5年中位数"
    if fv is None and pb_now and pb_now > 0 and pb_med and pb_med > 0:
        ratio = pb_med / pb_now
        if 1 / 3 <= ratio <= 3:
            fv, basis = price * ratio, "PB 5年中位数"
    if fv is None:
        return None, None
    # 钳制只是安全阀，但必须留痕：长鑫科技真实比值 2.40 倍被钳到 2.0，
    # 用户看到「现价低于合理估值 50%」会以为是精确计算值，实际是边界值。
    fv_raw = fv
    fv = min(max(fv, price * 0.5), price * 2.0)
    if abs(fv - fv_raw) > 0.01:
        basis = f"{basis}·实际 {fv_raw / price:.2f} 倍超出可信范围，显示为边界值"
    return round(fv, 2), basis


def is_etf_code(code: str) -> bool:
    """A 股 ETF 代码：沪市 51x/56x/58x，深市 15x/16x。ETF 没有个股 PE 分位。"""
    c = (code or "").strip()
    return c.startswith(("51", "56", "58", "15", "16"))


def fmt_pct(v, spec: str = ".0f", dash: str = "—") -> str:
    """None 安全的百分比格式化。

    事故背景：新买入的标的没有估值缓存（例如 588080 科创50ETF、688825 芯联集成），
    估值分位 blend_pct 为 None；原来直接 f"{fmt_pct(blend_pct)}%" 会抛
    TypeError: unsupported format string passed to NoneType.__format__，
    整个脚本崩掉 → /api/portfolio-advice 返回 500 → 前端「分析不出来」。
    """
    if v is None:
        return dash
    try:
        return format(float(v), spec)
    except (TypeError, ValueError):
        return dash


_INDEX_VAL_CACHE: dict | None = None


def load_index_valuation_map() -> dict[str, dict]:
    """读取 cache/index_valuations.json → {指数代码: 记录}。

    用途：ETF 没有个股 PE 分位，用它跟踪的指数分位作为参考
    （例如 588080 科创50ETF → 000688 科创50）。
    """
    global _INDEX_VAL_CACHE
    if _INDEX_VAL_CACHE is not None:
        return _INDEX_VAL_CACHE
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "cache", "index_valuations.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        _INDEX_VAL_CACHE = {i.get("code"): i for i in raw.get("indices", []) if i.get("code")}
    except Exception:
        _INDEX_VAL_CACHE = {}
    return _INDEX_VAL_CACHE


# ============================================================
# 质量维度：护城河评级 + ROIC 跑赢资金成本年数 + 股东总回报
# ------------------------------------------------------------
# 为什么不用单一阈值：
#   · 长江电力 ROIC 只有 5.1%（水电资本密集，天生低），但护城河评级是「宽」
#   · 招商银行 ROIC 干脆没有数据（银行口径不适用，用 ROE 更合适）
#   · 阿里 ROIC 6.3%、5 年只有 1 年跑赢资金成本、股东回报 1.14%、毛利 5 年 -17.4pp
# 单看 ROIC 会把长电误判成烂公司、把招行判成没数据；
# 单看护城河评分又会漏掉「便宜但资本回报烂」的票。所以做三维投票，两项差才算不合格。
# 数据来源：moat_cache.json（评分/盈利持续性/股东回报）+ financials_cache.json（ROIC）
# ============================================================

_QUALITY_CACHE: tuple[dict, dict] | None = None


def _load_quality_caches() -> tuple[dict, dict]:
    """懒加载护城河与财务缓存，避免每只持仓重复读盘"""
    global _QUALITY_CACHE
    if _QUALITY_CACHE is None:
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        moat, fin = {}, {}
        try:
            with open(os.path.join(base, "moat_cache.json"), encoding="utf-8") as f:
                moat = json.load(f)
        except Exception:
            pass
        try:
            with open(os.path.join(base, "financials_cache.json"), encoding="utf-8") as f:
                fin = json.load(f)
        except Exception:
            pass
        _QUALITY_CACHE = (moat, fin)
    return _QUALITY_CACHE


def evaluate_quality(stock_code: str) -> dict | None:
    """评估个股质量。数据全部缺失时返回 None —— 缺数据不编造，也不给中性结论。"""
    moat_map, fin_map = _load_quality_caches()
    moat = moat_map.get(stock_code) or {}
    fin = fin_map.get(stock_code) or {}
    if not moat and not fin:
        return None

    dims = moat.get("dims") or {}
    stay = dims.get("盈利持续性") or {}
    ret = dims.get("股东回报") or {}
    pricing = dims.get("定价权") or {}

    rating = moat.get("rating")               # wide / narrow / none
    score = moat.get("score")
    years_above = stay.get("years_above_wacc")
    roic = fin.get("roic")
    if roic is None:
        roic = stay.get("roic_avg5")
    share_yield = ret.get("shareholderYield")
    gm_trend = pricing.get("gm_trend")

    # 三维投票：每维 好(+1) / 中(0) / 差(-1)
    votes = []
    votes.append(1 if rating == "wide" else (-1 if rating == "none" else 0))
    if years_above is not None:
        votes.append(1 if years_above >= 4 else (-1 if years_above <= 1 else 0))
    if share_yield is not None:
        votes.append(1 if share_yield >= 3 else (-1 if share_yield < 1 else 0))

    bad, good = votes.count(-1), votes.count(1)
    grade = "poor" if bad >= 2 else ("good" if good >= 2 else "fair")

    # 警示只在质量确实有问题时给，避免刷屏
    warnings = []
    if years_above is not None and years_above <= 1:
        warnings.append(f"ROIC 近 5 年只有 {years_above} 年跑赢资金成本")
    if share_yield is not None and share_yield < 2:
        warnings.append(f"股东总回报仅 {share_yield:.2f}%，非收息资产")
    if gm_trend is not None and gm_trend <= -10:
        warnings.append(f"毛利率 5 年下行 {abs(gm_trend):.1f}pp")
    if rating == "none":
        warnings.append(f"护城河评级「{moat.get('ratingLabel') or '无'}」")

    return {
        "grade": grade,                  # good / fair / poor
        "rating": rating,
        "ratingLabel": moat.get("ratingLabel"),
        "score": score,
        "roic": roic,
        "yearsAboveWacc": years_above,
        "shareholderYield": share_yield,
        "gmTrend": gm_trend,
        "warnings": warnings,
    }


def etf_index_valuation(code: str) -> dict | None:
    """ETF → 标的指数的估值分位（没有映射或指数无分位时返回 None）。"""
    mapped = etf_underlying_index(code)
    if not mapped:
        return None
    idx_code, label = mapped
    rec = load_index_valuation_map().get(idx_code)
    if not rec or rec.get("pct_5y") is None:
        return None
    return {"pct": float(rec["pct_5y"]), "indexCode": idx_code,
            "indexName": rec.get("name") or label, "dataDate": rec.get("data_date"),
            "pe": rec.get("pe")}


def fmt_num(v, spec: str = ".2f", dash: str = "—") -> str:
    """None 安全的数字格式化（PB、合理估值这类可能缺失的值）。"""
    if v is None:
        return dash
    try:
        return format(float(v), spec)
    except (TypeError, ValueError):
        return dash


def evaluate_sell_advice(cost_diff_pct: float, blend_pct: float | None, window_label: str,
                         fair_value: float | None, current_price: float, shares: int,
                         quality_grade: str | None = None) -> list:
    """卖出侧建议（纯函数，便于单测）。

    规则（按优先级，命中即返）：
      R1 分位 ≥85（很贵）
          浮盈 >15% → 部分止盈 25%
          浮盈 >5%  → 估值高位减仓 15%
          否则      → 估值高位提示（不动手，等反弹）
      R1.5 质量不合格（护城河/资本回报两项差）且 分位 ≥70
          → 质量估值双弱·减仓 15%，**不要求浮盈**：
            质量差的公司贵了就该走，那笔浮盈是运气不是公司创造的价值。
            分位 <70 时不主动卖（便宜货可以等），避免把「便宜但烂」的仓位在低位割掉。
      R2 分位 ≥70（偏贵）
          浮盈 >15% 且 现价高于合理估值(含缓冲) → 部分止盈 25%
          浮盈 >15% 但未超合理估值             → 浮盈提示，不构成卖点
          浮盈 >5%                             → 逢高减仓 10%
      R3 分位 <70 或缺失（估值不贵）
          浮盈 >15% 且 现价高于合理估值(含缓冲) → 部分止盈 15%（超历史中位数）
          浮盈 >15%                            → 浮盈提示：估值未贵，不构成卖点
          浮盈 >5%                             → 浮盈记录（不操作）
    每条建议带 trigger 字段：估值驱动 / 仓位参考
    """

    def mk(action: str, reason: str, priority: str, trigger: str) -> list:
        return [{"action": action, "reason": reason, "priority": priority, "trigger": trigger}]

    pct_txt = f"{fmt_pct(blend_pct)}%（{window_label}）" if blend_pct is not None else "缺失"
    fair_txt = f"，合理估值 {fmt_num(fair_value)}" if fair_value else ""
    premium = (current_price / fair_value - 1) * 100 if fair_value else None
    above_fair = premium is not None and premium >= SELL_ABOVE_FAIR_PREMIUM
    # 文案要区分「高于但不显著」：补仓侧只要 >0 就说「高于合理估值 X%」，
    # 若这里说「未高于」，同一只票会出现「高于 4.9%」和「未高于」两句打架
    # （招行实录：溢价 4.9% < 5% 缓冲线，两侧口径不同）。
    if premium is None:
        above_fair_txt = "合理估值缺失"
    elif above_fair:
        above_fair_txt = f"现价高于合理估值 {premium:.1f}%"
    elif premium > 0:
        above_fair_txt = f"现价高于合理估值 {premium:.1f}%（未到 {SELL_ABOVE_FAIR_PREMIUM:.0f}% 缓冲线）"
    else:
        above_fair_txt = f"现价低于合理估值 {abs(premium):.1f}%"

    sell_full = max(round(shares * 0.25), 0)    # 部分止盈 25%
    sell_mid = max(round(shares * 0.15), 0)     # 估值高位减仓 15%
    sell_small = max(round(shares * 0.10), 0)   # 逢高减仓 10%

    if blend_pct is not None and blend_pct >= SELL_PCT_VERY_HIGH:
        if cost_diff_pct > SELL_PROFIT_CONFIRM:
            out = mk("部分止盈",
                     f"估值分位 {pct_txt} 处于历史高位{fair_txt and '，' + fair_txt[1:]}，"
                     f"叠加浮盈 {cost_diff_pct:.1f}%，建议减持 20-30%",
                     "high", "估值驱动")
            out.append({"action": f"卖 {sell_full} 股",
                        "reason": f"卖出 {sell_full} 股（约 25% 仓位）；估值高位是卖出理由，浮盈只是佐证",
                        "priority": "medium", "trigger": "估值驱动"})
            return out
        if cost_diff_pct > SELL_PROFIT_MIN:
            out = mk("估值高位减仓",
                     f"估值分位 {pct_txt} 已很高，浮盈仅 {cost_diff_pct:.1f}% 也该减——"
                     f"卖出看估值不看赚多少；建议减持 10-15%",
                     "high", "估值驱动")
            out.append({"action": f"卖 {sell_mid} 股",
                        "reason": f"卖出 {sell_mid} 股（约 15% 仓位），估值高位优先于浮盈多少",
                        "priority": "medium", "trigger": "估值驱动"})
            return out
        return mk("估值高位提示",
                  f"估值分位 {pct_txt} 处于历史高位，但浮盈仅 {cost_diff_pct:.1f}%（未到 5% 动手线）；"
                  f"反弹即分批减，别等回撤",
                  "medium", "估值驱动")

    # ── R1.5 质量闸门：质量不合格 + 估值偏贵 → 直接减仓，不等浮盈确认 ──
    # 为什么脱离浮盈：浮盈是你买得早，不代表公司还在创造价值。
    # 质量两项不达标（护城河 / ROIC 跑赢年数 / 股东回报 三项里两项差）的公司，
    # 估值偏贵时的正确动作是减，而不是「等涨到 15% 再说」。
    # 只对分位 ≥70 生效：分位低时即使质量差也不主动卖，避免低位割掉便宜货。
    if quality_grade == "poor" and blend_pct is not None and blend_pct >= SELL_PCT_HIGH:
        # 若浮盈条件已满足 R2 的卖出触发（浮盈 >15% 且现价超合理估值），交给 R2：
        # 那种情况 R2 减 25%，比这里的 15% 更彻底 —— 质量差不该反而减得更少。
        # R1.5 只兜住「原规则不会动手」的情形（浮亏、浮盈小、未超合理估值）。
        _r2_would_sell = cost_diff_pct > SELL_PROFIT_CONFIRM and above_fair
        if not _r2_would_sell:
            out = mk("质量估值双弱·减仓",
                     f"估值分位 {pct_txt} 偏高{fair_txt and '，' + fair_txt[1:]}，"
                     f"且质量不合格（护城河/资本回报不达标）；浮盈 {cost_diff_pct:.1f}% 只是佐证——"
                     f"质量差的公司贵了就该减，别陪它走下坡路",
                     "high", "估值驱动")
            out.append({"action": f"卖 {sell_mid} 股",
                        "reason": f"卖出 {sell_mid} 股（约 15% 仓位）：质量不合格 + 估值偏高，两个理由叠加",
                        "priority": "medium", "trigger": "估值驱动"})
            return out

    if blend_pct is not None and blend_pct >= SELL_PCT_HIGH:
        if cost_diff_pct > SELL_PROFIT_CONFIRM and above_fair:
            out = mk("部分止盈",
                     f"估值分位 {pct_txt} 偏高，且 {above_fair_txt}{fair_txt}，"
                     f"浮盈 {cost_diff_pct:.1f}%；建议减持 20-30%",
                     "high", "估值驱动")
            out.append({"action": f"卖 {sell_full} 股",
                        "reason": f"卖出 {sell_full} 股（约 25% 仓位），估值偏高 + 超合理估值，两个估值条件同时成立",
                        "priority": "medium", "trigger": "估值驱动"})
            return out
        if cost_diff_pct > SELL_PROFIT_CONFIRM:
            return mk("浮盈提示（不减仓）",
                      f"浮盈 {cost_diff_pct:.1f}%，但估值分位 {pct_txt} 只是偏高、{above_fair_txt}"
                      f"{fair_txt}——估值未到卖出条件，不构成卖点",
                      "medium", "仓位参考")
        if cost_diff_pct > SELL_PROFIT_MIN:
            out = mk("逢高减仓",
                     f"估值分位 {pct_txt} 偏高，浮盈 {cost_diff_pct:.1f}%，可减持 10-15%",
                     "medium", "估值驱动")
            out.append({"action": f"卖 {sell_small} 股",
                        "reason": f"卖出 {sell_small} 股（约 10% 仓位），估值偏高先减一点",
                        "priority": "low", "trigger": "估值驱动"})
            return out
        return []

    # 估值不贵（分位 <70% 或缺失）
    # 注意：分位 <50% 时一律不卖 —— 10 年分位与 5 年中位数用的是两个窗口，
    # 会出现「分位很低但现价略高于中位数」的伪信号（如 PE 7、PB 0.94 的银行），
    # 以分位为主判据，避免窗口打架把便宜货卖飞。
    if (cost_diff_pct > SELL_PROFIT_CONFIRM and above_fair
            and blend_pct is not None and blend_pct >= SELL_PCT_NEUTRAL):
        out = mk("部分止盈",
                 f"估值分位 {pct_txt} 尚未到偏贵线（{SELL_PCT_HIGH:.0f}%），但{above_fair_txt}"
                 f"{fair_txt}；卖出理由是现价超过历史中位数，不是赚得多。"
                 f"建议小比例减持 10-15%",
                 "high", "估值驱动")
        out.append({"action": f"卖 {sell_mid} 股",
                    "reason": f"卖出 {sell_mid} 股（约 15% 仓位），只是回到历史中位数的仓位再平衡",
                    "priority": "medium", "trigger": "估值驱动"})
        return out
    if cost_diff_pct > SELL_PROFIT_CONFIRM:
        return mk("浮盈提示（不减仓）",
                  f"浮盈 {cost_diff_pct:.1f}% 是你成本低/前期减仓摊薄的结果，与估值无关；"
                  f"估值分位 {pct_txt}、{above_fair_txt}{fair_txt}。"
                  f"分位低于 {SELL_PCT_NEUTRAL:.0f}% 时以分位为准，不因略微超过中位数卖出",
                  "medium", "仓位参考")
    if cost_diff_pct > SELL_PROFIT_MIN:
        return mk("浮盈记录",
                  f"浮盈 {cost_diff_pct:.1f}%，估值分位 {pct_txt} 不贵，无需操作",
                  "low", "仓位参考")
    return []


def analyze_position(pos: dict, quote: dict, val: dict | None = None) -> dict:
    """对单只持仓生成操作建议"""
    # 适配两种字段格式
    code = pos.get("stockCode") or pos.get("code", "")
    name = pos.get("stockName") or pos.get("name") or quote.get("name", code)
    shares = pos.get("shares", 0)
    buy_price = pos.get("buyPrice") or pos.get("cost", 0)
    total_cost = pos.get("totalCost") or (buy_price * shares if buy_price and shares else 0)
    buy_date = pos.get("buyDate") or pos.get("addedAt", "")
    dividends = pos.get("dividends", [])

    quote_price = quote.get("price")
    # 行情缺失时必须显式标记：原来直接 fallback 到成本价，会算出"盈亏 0%"
    # 并让所有补仓/止盈判断失效（588080 ETF 就踩过）
    price_missing = not quote_price or quote_price <= 0
    current_price = quote_price if not price_missing else buy_price
    div_yield = quote.get("dividendYield")
    # PE 口径必须与 pe_median_5y 同源，否则合理估值会算反：
    # estimate_fair_value 用 price × (PE中位数 / 当前PE)，中位数来自估值缓存，
    # 若当前 PE 取自行情源（港股腾讯常给 Non-GAAP，剔除投资损益/减值），
    # 两个口径混除会得出相反结论。实测阿里：行情 PE 16.2 vs 缓存 PE 23.95，
    # 同一只票算出「便宜 28.8%」和「贵 5.3%」两个相反答案。
    # 因此优先用估值缓存的 pe_ttm，无缓存时才对行情 PE 兜底。
    val_pe = (val or {}).get("pe_ttm")
    pe = val_pe if (val_pe is not None and val_pe > 0) else quote.get("pe")
    
    # 质量维度（护城河/ROIC/股东回报），数据缺失返回 None，不编造
    quality = evaluate_quality(code)

    # 如果 buy_price 或 current_price 为 0，无法计算，跳过此持仓
    if buy_price <= 0 or current_price <= 0:
        return None

    # 计算指标
    market_value = shares * current_price
    total_dividends = sum(d.get("total", 0) for d in dividends)
    real_cost = total_cost - total_dividends
    profit = market_value + total_dividends - total_cost
    profit_pct = (profit / total_cost * 100) if total_cost > 0 else 0

    # 成本股息率
    cost_yield = None
    if div_yield and real_cost > 0 and shares > 0:
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
    # 步长优先级: data/volatility_cache.json 真实波动率(20日σ×2) > 旧盈亏推导(废弃保留兜底)
    # 与 src/lib/grid-engine.ts、/api/volatility 保持同一口径
    vol_step = None
    vol_sigma = None
    try:
        vol_cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "volatility_cache.json")
        if os.path.exists(vol_cache_path):
            with open(vol_cache_path, "r", encoding="utf-8") as f:
                vol_items = json.load(f).get("items", {})
            v = vol_items.get(code)
            if v and v.get("step"):
                vol_step = float(v["step"])
                vol_sigma = float(v.get("sigma") or (vol_step * 2))
    except Exception:
        pass

    if vol_step is not None:
        grid_step = vol_step
        grid_volatility = vol_sigma
    else:
        # 兜底: 旧算法（真实波动率数据不可用时）
        if buy_price > 0:
            grid_volatility = max(abs(current_price - buy_price) / buy_price * 100, 3)
        else:
            grid_volatility = 3
        grid_step = max(round(grid_volatility * 0.5, 1), 2)

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

    # ── 策略 2: 做低成本建议（带估值闸门 + 补仓额度 + 补仓间距）──
    cost_diff = current_price - buy_price
    cost_diff_pct = (cost_diff / buy_price) * 100 if buy_price > 0 else 0

    # 补仓额度控制（防「补完再喊补」循环到全仓）：
    #   基准股数 = 首次建仓量（baseShares，老数据缺省=当前股数视为未补）
    #   已用额度 = (当前股数 - 基准) / 基准；上限 +100%（最多补到基准的 2 倍）
    base_shares = pos.get("baseShares") or shares
    if base_shares <= 0:
        base_shares = shares
    used_pct = max((shares - base_shares) / base_shares * 100, 0)
    remaining_pct = max(100 - used_pct, 0)
    last_add_price = pos.get("lastAddPrice")

    # 补仓间距：上次加仓价之上未回落满一个网格步长 → 不追加建议（等跌够了再说）
    def add_spacing_ok() -> tuple[bool, str]:
        if last_add_price and last_add_price > 0:
            threshold = last_add_price * (1 - grid_step / 100)
            if current_price > threshold:
                return False, f"上次加仓价 {last_add_price:.2f}，需回落 ≥{grid_step:.1f}%（{threshold:.2f} 下方）再补"
        return True, ""

    spacing_ok, spacing_reason = add_spacing_ok()

    # 融合估值分位：PE 为主（盈利股），PB 兜底（亏损股）——与 trade-advice.ts 同口径
    # 决策主口径 = 10 年档（A股东财源实际覆盖 2018 起 ≈8.7 年；港股百度近十年），
    # 5 年分位降级为文案补充，全历史仅作最后兜底
    val = val or {}
    pe5 = val.get("pe_pct_5y")
    pb5 = val.get("pb_pct_5y")
    pe10 = val.get("pe_pct_10y")
    pb10 = val.get("pb_pct_10y")
    pb_abs = val.get("pb")
    eff5 = pe5 if (pe is not None and pe > 0) else None
    eff10 = pe10 if (pe is not None and pe > 0) else None

    def _blend(e, p):
        return (e * 0.6 + p * 0.4) if (e is not None and p is not None) else (e if e is not None else p)

    # 上市不足 1 年的新股标记（下面全历史兜底会置 True，补仓分支据此给专门的文案）
    history_too_short = False
    blend5 = _blend(eff5, pb5)
    blend10 = _blend(eff10, pb10)
    blend_pct = blend10 if blend10 is not None else blend5
    window_label = "10年" if blend10 is not None else "5年"

    # 统一新股闸门：只要样本不足 1 年，无论分位是从哪个窗口来的都作废。
    # 原来只在「全历史兜底」那一支检查，若数据源直接给了 5y 分位就绕过去了 ——
    # 长鑫科技式的假分位只要换条路径就能复活。
    _hy = (val or {}).get("history_years")
    if blend_pct is not None and _hy is not None and _hy < 1.0:
        blend_pct = None
        window_label = ""
        history_too_short = True

    pe_pct_all = val.get("pe_pct_all")
    pb_pct_all = val.get("pb_pct_all")
    eff_pe_all = pe_pct_all if (pe is not None and pe > 0) else None
    blend_all = (eff_pe_all * 0.6 + pb_pct_all * 0.4) if (eff_pe_all is not None and pb_pct_all is not None) \
        else (eff_pe_all if eff_pe_all is not None else pb_pct_all)
    if blend_pct is None and blend_all is not None:
        hy = (val or {}).get("history_years")
        # 上市不足 1 年的新股：所谓「全历史分位」只是几个月内的位置（长鑫科技 688825
        # 只有 73 个交易日），拿它当估值锚等于把噪声当信号。这种情况宁可不给分位，
        # 让下游走「估值数据缺失」分支，也不要输出一个看起来精确的数字。
        if hy is not None and hy < 1.0:
            history_too_short = True
        else:
            blend_pct = blend_all
            window_label = f"全历史{hy:.1f}年" if hy else "全历史"

    # ETF 没有个股 PE 分位 → 用标的指数分位兜底（588080 → 科创50）
    index_val_note = None
    if blend_pct is None:
        iv = etf_index_valuation(code)
        if iv is not None:
            blend_pct = iv["pct"]
            window_label = f"{iv['indexName']}指数5年"
            index_val_note = (f"ETF 无个股分位，取标的指数 {iv['indexName']}({iv['indexCode']}) "
                              f"5年分位 {iv['pct']:.0f}%（数据日 {iv.get('dataDate') or '未知'}）")

    # 5 年与 10 年档差异 ≥5pp 时在文案中补充短周期视角
    # 铁律：结论词必须紧跟主口径（10 年），短周期差异只能放括号里并标明方向。
    # 曾因把 suffix 拼在结论词前面，产生「5年分位 80%，偏低区间」这种自相矛盾的文案。
    blend5_suffix = ""
    if blend10 is not None and blend5 is not None and abs(blend10 - blend5) >= 5:
        _gap = blend5 - blend10
        _trend = "短周期偏高" if _gap > 0 else "短周期偏低"
        blend5_suffix = f"（5年分位 {blend5:.0f}%，{_trend}）"

    # 合理估值锚（历史倍数中位数反推，纯数据、不做盈利预测）——卖出侧的第二重闸门
    fair_value, fair_basis = estimate_fair_value(val, current_price, pe)
    fair_premium_pct = round((current_price / fair_value - 1) * 100, 2) if fair_value else None

    # 三种状态必须分开，否则会把"没有估值数据"当成"亏损股"：
    #   ① 亏损股：PE < 0
    #   ② 有分位数据：blend_pct 有值
    #   ③ 分位缺失：既不是亏损股，也没有估值缓存（新买入/ETF/缓存未建）
    is_loss_stock = (pe is not None and pe < 0)
    no_val_data = (not is_loss_stock) and blend_pct is None
    loss_no_margin = is_loss_stock and (pb_abs is None or pb_abs > 3)
    etf_hint = "（ETF 没有个股 PE 分位，应参考其标的指数分位）" if is_etf_code(code) else ""
    if index_val_note and is_etf_code(code):
        etf_hint = f"（{index_val_note}）"

    cost_advice = []
    # ── 补仓闸门 = 估值驱动，成本价不参与触发 ──
    # 铁律：成本价是沉没成本，只用于展示收益率，绝不做买入决策的主驱动。
    # 旧实现以 cost_diff_pct < -10 作入口，后果是双向失真：
    #   ① 估值分位 5% 的票，只要现价高于成本，永不提示补仓；
    #   ② 跌破成本 10% 的票，哪怕分位 90%，也先被拉进补仓评估（再靠估值事后否决）。
    # 现在改为：分位决定"能不能补"，安全边际/额度/间距决定"补多少"。
    if loss_no_margin:
        cost_advice.append({
            "action": "不建议补仓",
            "reason": (f"亏损股 PB {fmt_num(pb_abs, '.2f')} 倍仍高" if pb_abs is not None else "亏损股且 PB 数据缺失")
                      + "，无盈利无股息缺安全垫，摊低成本无意义",
            "priority": "high",
        })
    elif no_val_data:
        hy = (val or {}).get("history_years")
        if history_too_short or (hy is not None and hy < 1.0):
            # 新股：不是「没抓数据」，而是抓到了但没有足够历史 —— 两者结论不同
            why = (f"该标的上市仅 {hy:.1f} 年（{int((val or {}).get('history_points') or 0)} 个交易日），"
                   "历史估值样本撑不起有意义的分位 —— 用几个月的数据算「十年分位」会得出假信号，"
                   "所以这里不给数字；只宜按仓位纪律和基本面判断，别当估值便宜")
        else:
            why = f"该标的没有估值分位数据，无法判断贵不贵{etf_hint}"
        cost_advice.append({
            "action": "估值数据缺失·按纪律判断",
            "reason": why + "；先补齐估值再决定，或只按补仓额度/间隔纪律小幅试探",
            "priority": "medium",
        })
    elif blend_pct is not None and blend_pct < 50:
        # 估值确实进到偏低区，再看安全边际 / 补仓额度 / 加仓间距
        if fair_premium_pct is not None and fair_premium_pct > 0:
            # 把短周期分位一并说清：只报「10年分位 30% 偏低」会让人以为是便宜货，
            # 而招行/美的的 10 年分位是被 2018-2021 高估值拉宽的——它们的 5 年分位
            # 分别是 52%/78%，近一年分位 77%/66%，短周期根本不便宜。
            # 只给长期分位会让「估值偏低」和「暂缓补仓」看起来互相打架。
            _short = ""
            if blend5 is not None and blend_pct is not None:
                _gap = blend5 - blend_pct
                if _gap >= 10:
                    _short = f"；且 5 年分位 {blend5:.0f}%，短周期本身就不便宜"
                elif _gap <= -10:
                    _short = f"；5 年分位 {blend5:.0f}%，短周期比长期更便宜"
            # 质量不合格要一并说清：否则用户会以为「等跌到位就该重仓」，
            # 而质量差的票跌到位也只值得小仓位试探。
            q = quality or {}
            q_warn = ""
            if q.get("grade") == "poor":
                why = "、".join([w for w in (q.get("warnings") or []) if "护城河评级" not in w])
                if why:
                    q_warn = f"；且{why}，即使跌到位也只宜小仓位试探"
            cost_advice.append({
                "action": "暂缓补仓",
                "reason": (f"估值分位（{window_label}）{fmt_pct(blend_pct)}% 偏低{_short}，"
                           f"但现价仍高于合理估值 {fair_premium_pct:.1f}%（{fmt_num(fair_value, '.2f')}）"
                           f"——分位低不等于价格便宜，等跌进安全边际再补{q_warn}"),
                "priority": "medium",
            })
        elif used_pct >= 100:
            cost_advice.append({
                "action": "补仓额度已用完",
                "reason": f"估值分位（{window_label}）{fmt_pct(blend_pct)}% 偏低，但已补 {used_pct:.0f}%（基准 {base_shares} 股 → 现持 {shares} 股）达上限，纪律优先不再加",
                "priority": "medium",
            })
        elif not spacing_ok:
            cost_advice.append({
                "action": "补仓间隔未到",
                "reason": f"估值已到补仓区（{window_label}分位 {fmt_pct(blend_pct)}%），但{spacing_reason}，避免密集补仓",
                "priority": "medium",
            })
        else:
            margin_note = ""
            if fair_premium_pct is not None and fair_premium_pct <= 0:
                margin_note = f"，现价低于合理估值 {abs(fair_premium_pct):.1f}%（{fmt_num(fair_value, '.2f')}）"
            q = quality or {}
            q_grade = q.get("grade")
            # ── 质量闸门：便宜 ≠ 该买 ──
            # 「分位低 + 跌进安全边际」只说明价格合适，不说明公司值得持有。
            # 质量不合格（三维投票两项差）时降级为 medium 并把单批额度减半，
            # 同时必须写明哪一项不合格，避免用户看到「可补」就动手。
            if q_grade == "poor":
                why = "、".join(q.get("warnings") or []) or "护城河与资本回报均不达标"
                cost_advice.append({
                    "action": "补仓（质量不合格·建议减半）",
                    "reason": f"估值分位（{window_label}）{fmt_pct(blend_pct)}% 处于偏低区间{margin_note}，但{why}——便宜但质量不合格，只适合小仓位试探，不建议重仓",
                    "priority": "medium",
                })
            else:
                q_note = ""
                if q_grade == "good":
                    label = q.get("ratingLabel") or ""
                    sc = q.get("score")
                    q_note = f"，质量{label}" + (f"（{sc:.0f} 分）" if sc is not None else "")
                    sy = q.get("shareholderYield")
                    if sy is not None:
                        q_note += f"、股东总回报 {sy:.2f}%"
                cost_advice.append({
                    "action": "补仓",
                    "reason": f"估值分位（{window_label}）{fmt_pct(blend_pct)}% 处于偏低区间{margin_note}{q_note}，估值驱动可补",
                    "priority": "high",
                })
            # 建议补仓量：质量合格给基准仓位的 30%，不合格减半到 15%，受剩余额度封顶，取整百
            if total_cost > 0 and base_shares > 0:
                frac = 0.15 if q_grade == "poor" else 0.3
                quota_shares = int(base_shares * remaining_pct / 100)
                add_shares = min(round(base_shares * frac), quota_shares)
                add_shares = max(add_shares // 100 * 100, 0)
                if add_shares >= 100:
                    left_after = max(remaining_pct - (add_shares / base_shares * 100), 0)
                    cost_advice.append({
                        "action": f"补 {add_shares} 股",
                        "reason": f"当前持有 {shares} 股，建议补 {add_shares} 股（基准的 {frac*100:.0f}%，剩余额度 {remaining_pct:.0f}%，补后剩 {left_after:.0f}%）",
                        "priority": "medium",
                    })
    # 「估值中性·质量不合格」不在这里给 —— 必须等卖出侧算完再判断，
    # 否则分位 50~70 且浮盈高时会同时出现「估值中性」和「部分止盈」，自相矛盾。
    # 分位 >=50（中性或偏贵）且质量不差时不给补仓建议：既不便宜也没到该动手的位置，沉默比提醒更有用

    # ── 卖出侧：估值驱动，与买入侧对称（规则表见 evaluate_sell_advice）──
    # 成本收益率在这里只作「确认」与仓位参考，不再单独触发减仓。
    cost_advice.extend(evaluate_sell_advice(
        cost_diff_pct, blend_pct, window_label, fair_value, current_price, shares,
        quality_grade=(quality or {}).get("grade")))

    # ── 中性分位 + 质量差的补充结论（必须在卖出侧之后判断）──
    # 只有「卖出侧也没有动作」时才给，否则会和「部分止盈」同时出现，
    # 同一只票一边说估值中性、一边让你卖，读起来就是自相矛盾。
    _has_sell_act = any(
        a["action"].startswith("卖") or (("止盈" in a["action"] or "减仓" in a["action"])
                                         and "不减仓" not in a["action"])
        for a in cost_advice
    )
    if (not _has_sell_act and quality and quality.get("grade") == "poor"
            and blend_pct is not None and SELL_PCT_NEUTRAL <= blend_pct < SELL_PCT_HIGH):
        why = "、".join([w for w in (quality.get("warnings") or [])
                         if "护城河评级" not in w]) or "质量不合格"
        prem = (f"，现价还高于合理估值 {fair_premium_pct:.1f}%"
                if (fair_premium_pct is not None and fair_premium_pct > 0) else "")
        cost_advice.append({
            "action": "估值中性·质量不合格",
            "reason": (f"估值分位（{window_label}）{fmt_pct(blend_pct)}% 属中间位置，谈不上便宜{prem}；"
                       f"且{why}——不建议加仓"),
            "priority": "medium",
        })
    # ── 策略 2.5: 止损/纪律检查（价值派口径：止损看逻辑破坏，不看跌幅本身）──
    stop_advice = []
    drawdown = -cost_diff_pct  # 正数 = 回撤幅度
    if is_loss_stock:
        if loss_no_margin:
            stop_advice.append({
                "action": "投机仓纪律",
                "reason": f"亏损股 PB {fmt_num(pb_abs, '.2f')} 倍，无盈利无股息不符合价值体系；建议仓位上限 5%，回撤超 30% 强制减半",
                "priority": "high",
            })
        if drawdown >= 30:
            stop_advice.append({
                "action": "纪律减半",
                "reason": f"回撤 {drawdown:.0f}% 已达投机仓强制风控线，建议减半控制风险，剩余仓位看亏损收窄斜率",
                "priority": "high",
            })
    elif blend_pct is not None and blend_pct > 95 and drawdown > 10:
        stop_advice.append({
            "action": "基本面止损预警",
            "reason": f"回撤 {drawdown:.0f}% 但盈利下滑推高估值分位至 {fmt_pct(blend_pct)}%——跌了反而更贵；若下季财报盈利继续恶化应减仓",
            "priority": "high",
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

    # ── 策略 4: 估值提示（分位制，与 trade-advice.ts 同口径）──
    # 主口径 10 年档；与 5 年档差异 ≥5pp 时补充短周期视角
    val_advice = []
    if blend_pct is not None:
        if blend_pct < 20:
            val_advice.append({
                "action": "估值历史低位",
                "reason": f"估值分位 {fmt_pct(blend_pct)}%（{window_label}），安全边际厚{blend5_suffix}",
                "priority": "high",
            })
        elif blend_pct < 50:
            val_advice.append({
                "action": "估值偏低",
                "reason": f"估值分位 {fmt_pct(blend_pct)}%（{window_label}），偏低区间{blend5_suffix}",
                "priority": "medium",
            })
        elif blend_pct < 80:
            val_advice.append({
                "action": "估值中枢",
                "reason": f"估值分位 {fmt_pct(blend_pct)}%（{window_label}），合理区间{blend5_suffix}",
                "priority": "info",
            })
        else:
            val_advice.append({
                "action": "估值高位",
                "reason": f"估值分位 {fmt_pct(blend_pct)}%（{window_label}），注意回撤风险{blend5_suffix}",
                "priority": "medium",
            })
    elif pe:
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

    # ── 统一补齐 trigger（触发源）字段：让每条建议能分辨「因为估值」还是「因为仓位/纪律/股息」──
    for a in cost_advice:
        if not a.get("trigger"):
            act = a.get("action", "")
            a["trigger"] = "纪律" if ("额度" in act or "间隔" in act) else "估值驱动"
    for a in stop_advice:
        a.setdefault("trigger", "纪律")
    for a in div_advice:
        a.setdefault("trigger", "股息")
    for a in val_advice:
        a.setdefault("trigger", "估值")

    # ── 冲突消解：卖出动作已成立时，不再并列「长持吃分红」这类持有建议 ──
    # 否则同一只票会同时出现「部分止盈」和「持有收息」，看的人无法执行。
    # 注意：必须按 trigger 判定，否则「浮盈提示（不减仓）」里的「减仓」二字会误判为卖出。
    has_sell = any(
        a.get("trigger") == "估值驱动" and (
            "卖 " in a.get("action", "")
            or "止盈" in a.get("action", "")
            or "减仓" in a.get("action", ""))
        for a in cost_advice
    )
    if has_sell:
        for a in div_advice:
            if a.get("action") in ("持有收息", "继续持有"):
                a["priority"] = "info"

    # ── 综合操作建议 ──────────────────────────────────
    operations = []
    # 止损/纪律建议最优先，其余按 cost/div/val 顺序
    all_high = [a for a in stop_advice + cost_advice + div_advice + val_advice if a.get("priority") == "high"]
    all_medium = [a for a in stop_advice + cost_advice + div_advice + val_advice if a.get("priority") == "medium"]

    for a in all_high[:2]:
        operations.append({
            "action": a["action"],
            "reason": a["reason"],
            "priority": "high",
            "trigger": a.get("trigger"),
        })
    for a in all_medium[:3]:
        operations.append({
            "action": a["action"],
            "reason": a["reason"],
            "priority": "medium",
            "trigger": a.get("trigger"),
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
        # 股息率来源：cninfo=真实每股分红 / estimate=payout÷PE 估算（港股常为估算）
        "dividendYieldSource": quote.get("dividendYieldSource"),
        "pe": pe,
        "daysHeld": days_held,
        # ── 估值侧口径（卖出决策的依据，与成本收益率解耦）──
        "valuationPct": round(blend_pct, 1) if blend_pct is not None else None,
        "valuationWindow": window_label if blend_pct is not None else None,
        "valuationSource": index_val_note,
        "quoteMissing": price_missing,
        # 亏损股没有有效 PE，分位只看 PB → 前端标签要显示「PB 分位」避免误读成"便宜"
        "valuationBasis": ("指数分位" if index_val_note
                           else ("PB" if (eff10 is None and eff5 is None) else "PE+PB")),
        "fairValue": fair_value,
        "fairValueBasis": fair_basis,
        "fairValuePremiumPct": fair_premium_pct,
        "quality": quality,
        "costProfitPct": round(cost_diff_pct, 2),
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
    # 兼容两种字段名：code 或 stockCode
    codes = [p.get("stockCode") or p.get("code") for p in portfolio]
    quotes = fetch_tencent_quotes(codes)
    val_cache = load_valuation_cache()  # 估值分位缓存（含港股，补仓闸门/止损分析用）

    # 股息率口径：真实每股分红（cninfo TTM）优先，估算（payout÷PE）只在缺失时兜底
    # 改前是 max(real, est) → 成本股息率虚高（600036 10.8% vs 真实 9.04%）
    try:
        em_divs = fetch_dividend_yields(codes)
        for code, div_data in em_divs.items():
            if div_data and div_data.get("dividend_per_share") is not None and code in quotes:
                dps = div_data["dividend_per_share"]
                price = quotes[code].get("price", 0)
                est_dy = quotes[code].get("dividendYield", 0) or 0
                dy, src = pick_dividend_yield(dps, price, est_dy)
                quotes[code]["dividendYield"] = dy
                quotes[code]["dividendYieldSource"] = src
                quotes[code]["dividendPerShare"] = dps
    except Exception:
        pass  # cninfo 不可用时静默回退到估算值（来源标记为 estimate）

    # 逐个分析
    advice = []
    for pos in portfolio:
        code = pos.get("stockCode") or pos.get("code")
        quote = quotes.get(code, {})
        # 更新名称
        if quote.get("name"):
            pos["stockName"] = quote["name"]
        # 确保 stockCode 字段存在
        pos["stockCode"] = code
        try:
            result = analyze_position(pos, quote, val_cache.get(code))
        except Exception as exc:  # 单只失败不能拖垮整批（历史上就是这样整页空白）
            result = {
                "stockCode": code,
                "stockName": pos.get("stockName") or code,
                "action": "分析失败",
                "reason": f"{type(exc).__name__}: {exc}",
                "priority": "low",
                "degraded": True,
            }
            print(f"WARN: analyze failed for {code}: {type(exc).__name__}: {exc}", file=sys.stderr)
        if result:  # 只添加有效的分析结果
            advice.append(result)

    print(json.dumps({"success": True, "advice": advice, "generatedAt": datetime.now().isoformat()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
