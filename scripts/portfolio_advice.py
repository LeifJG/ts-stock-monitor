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

from net_utils import setup_proxy_env

setup_proxy_env()

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
    fv = min(max(fv, price * 0.5), price * 2.0)
    return round(fv, 2), basis


def evaluate_sell_advice(cost_diff_pct: float, blend_pct: float | None, window_label: str,
                         fair_value: float | None, current_price: float, shares: int) -> list:
    """卖出侧建议（纯函数，便于单测）。

    规则（按优先级，命中即返）：
      R1 分位 ≥85（很贵）
          浮盈 >15% → 部分止盈 25%
          浮盈 >5%  → 估值高位减仓 15%
          否则      → 估值高位提示（不动手，等反弹）
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

    pct_txt = f"{blend_pct:.0f}%（{window_label}）" if blend_pct is not None else "缺失"
    fair_txt = f"，合理估值 {fair_value:.2f}" if fair_value else ""
    premium = (current_price / fair_value - 1) * 100 if fair_value else None
    above_fair = premium is not None and premium >= SELL_ABOVE_FAIR_PREMIUM
    above_fair_txt = f"现价高于合理估值 {premium:.0f}%" if above_fair else "现价未高于合理估值"

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

    current_price = quote.get("price", buy_price)
    div_yield = quote.get("dividendYield")
    pe = quote.get("pe")
    
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

    blend5 = _blend(eff5, pb5)
    blend10 = _blend(eff10, pb10)
    blend_pct = blend10 if blend10 is not None else blend5
    window_label = "10年" if blend10 is not None else "5年"

    pe_pct_all = val.get("pe_pct_all")
    pb_pct_all = val.get("pb_pct_all")
    eff_pe_all = pe_pct_all if (pe is not None and pe > 0) else None
    blend_all = (eff_pe_all * 0.6 + pb_pct_all * 0.4) if (eff_pe_all is not None and pb_pct_all is not None) \
        else (eff_pe_all if eff_pe_all is not None else pb_pct_all)
    if blend_pct is None and blend_all is not None:
        blend_pct = blend_all
        window_label = "全历史"

    # 5 年与 10 年档差异 ≥5pp 时在文案中补充短周期视角
    blend5_suffix = ""
    if blend10 is not None and blend5 is not None and abs(blend10 - blend5) >= 5:
        blend5_suffix = f"；5年分位 {blend5:.0f}%"

    # 合理估值锚（历史倍数中位数反推，纯数据、不做盈利预测）——卖出侧的第二重闸门
    fair_value, fair_basis = estimate_fair_value(val, current_price, pe)
    fair_premium_pct = round((current_price / fair_value - 1) * 100, 2) if fair_value else None

    # 亏损股判定：PE 负值或缺失，且 PB 绝对值仍高（>3 倍，对亏损公司无安全垫）
    is_loss_stock = (pe is not None and pe < 0) or (eff10 is None and pb10 is None and eff5 is None and pb5 is None)
    loss_no_margin = is_loss_stock and (pb_abs is None or pb_abs > 3)

    cost_advice = []
    if cost_diff_pct < -10:
        # 估值闸门：回撤≠便宜，先看分位再谈补仓
        if loss_no_margin:
            cost_advice.append({
                "action": "不建议补仓",
                "reason": f"低于成本 {abs(cost_diff_pct):.1f}%，但亏损股 PB {pb_abs} 倍仍高，无盈利无股息缺安全垫，摊低成本无意义",
                "priority": "high",
            })
        elif blend_pct is not None and blend_pct > 80:
            cost_advice.append({
                "action": "不建议补仓",
                "reason": f"虽低于成本 {abs(cost_diff_pct):.1f}%，但估值分位（{window_label}）{blend_pct:.0f}% 仍处历史高位，回撤未消化完，补仓=接飞刀",
                "priority": "high",
            })
        elif blend_pct is not None and blend_pct > 50:
            cost_advice.append({
                "action": "暂缓补仓",
                "reason": f"低于成本 {abs(cost_diff_pct):.1f}% 但估值分位（{window_label}）{blend_pct:.0f}% 中性偏高，等分位 <50% 或基本面确认再补",
                "priority": "medium",
            })
        else:
            # ── 估值过关，再看补仓额度和间距 ──
            if used_pct >= 100:
                cost_advice.append({
                    "action": "补仓额度已用完",
                    "reason": f"低于成本 {abs(cost_diff_pct):.1f}% 且估值分位（{window_label}）{blend_pct:.0f}% 偏低，但已补 {used_pct:.0f}%（基准 {base_shares} 股 → 现持 {shares} 股）达上限，纪律优先不再加",
                    "priority": "medium",
                })
            elif not spacing_ok:
                cost_advice.append({
                    "action": "补仓间隔未到",
                    "reason": f"估值已到补仓区（{window_label}分位 {blend_pct:.0f}%），但{spacing_reason}，避免密集补仓",
                    "priority": "medium",
                })
            else:
                cost_advice.append({
                    "action": "补仓",
                    "reason": f"现价低于成本价 {abs(cost_diff_pct):.1f}%，且估值分位（{window_label}）{blend_pct:.0f}% 偏低，适合补仓摊低成本",
                    "priority": "high",
                })
                # 建议补仓量：单批基准仓位的 30%，受剩余额度封顶，取整百
                if total_cost > 0 and base_shares > 0:
                    quota_shares = int(base_shares * remaining_pct / 100)
                    add_shares = min(round(base_shares * 0.3), quota_shares)
                    add_shares = max(add_shares // 100 * 100, 0)
                    if add_shares >= 100:
                        left_after = max(remaining_pct - (add_shares / base_shares * 100), 0)
                        cost_advice.append({
                            "action": f"补 {add_shares} 股",
                            "reason": f"当前持有 {shares} 股，建议补 {add_shares} 股（基准的 30%，剩余额度 {remaining_pct:.0f}%，补后剩 {left_after:.0f}%）",
                            "priority": "medium",
                        })
    elif cost_diff_pct < -5:
        if blend_pct is not None and blend_pct > 50:
            cost_advice.append({
                "action": "暂缓补仓",
                "reason": f"小幅回撤 {abs(cost_diff_pct):.1f}%，但估值分位（{window_label}）{blend_pct:.0f}% 偏高，暂不补",
                "priority": "medium",
            })
        elif used_pct >= 100:
            cost_advice.append({
                "action": "补仓额度已用完",
                "reason": f"小幅回撤 {abs(cost_diff_pct):.1f}%，但已补 {used_pct:.0f}% 达上限，小回撤不值得动用纪律额度",
                "priority": "medium",
            })
        elif not spacing_ok:
            cost_advice.append({
                "action": "补仓间隔未到",
                "reason": spacing_reason,
                "priority": "medium",
            })
        else:
            cost_advice.append({
                "action": "轻仓补入",
                "reason": f"小幅回撤 {abs(cost_diff_pct):.1f}%，估值分位（{window_label}）{blend_pct:.0f}% 合理，可小批量补仓",
                "priority": "medium",
            })
    else:
        # ── 卖出侧：估值驱动（规则表见 evaluate_sell_advice）──
        # 成本收益率（cost_diff_pct）在这里只作「确认」与仓位参考，不再单独触发减仓
        cost_advice.extend(evaluate_sell_advice(
            cost_diff_pct, blend_pct, window_label, fair_value, current_price, shares))

    # ── 策略 2.5: 止损/纪律检查（价值派口径：止损看逻辑破坏，不看跌幅本身）──
    stop_advice = []
    drawdown = -cost_diff_pct  # 正数 = 回撤幅度
    if is_loss_stock:
        if loss_no_margin:
            stop_advice.append({
                "action": "投机仓纪律",
                "reason": f"亏损股 PB {pb_abs} 倍，无盈利无股息不符合价值体系；建议仓位上限 5%，回撤超 30% 强制减半",
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
            "reason": f"回撤 {drawdown:.0f}% 但盈利下滑推高估值分位至 {blend_pct:.0f}%——跌了反而更贵；若下季财报盈利继续恶化应减仓",
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
                "reason": f"估值分位 {blend_pct:.0f}%（{window_label}）{blend5_suffix}，安全边际厚",
                "priority": "high",
            })
        elif blend_pct < 50:
            val_advice.append({
                "action": "估值偏低",
                "reason": f"估值分位 {blend_pct:.0f}%（{window_label}）{blend5_suffix}，偏低区间",
                "priority": "medium",
            })
        elif blend_pct < 80:
            val_advice.append({
                "action": "估值中枢",
                "reason": f"估值分位 {blend_pct:.0f}%（{window_label}）{blend5_suffix}，合理区间",
                "priority": "info",
            })
        else:
            val_advice.append({
                "action": "估值高位",
                "reason": f"估值分位 {blend_pct:.0f}%（{window_label}）{blend5_suffix}，注意回撤风险",
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
        # 亏损股没有有效 PE，分位只看 PB → 前端标签要显示「PB 分位」避免误读成"便宜"
        "valuationBasis": "PB" if (eff10 is None and eff5 is None) else "PE+PB",
        "fairValue": fair_value,
        "fairValueBasis": fair_basis,
        "fairValuePremiumPct": fair_premium_pct,
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
        result = analyze_position(pos, quote, val_cache.get(code))
        if result:  # 只添加有效的分析结果
            advice.append(result)

    print(json.dumps({"success": True, "advice": advice, "generatedAt": datetime.now().isoformat()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
