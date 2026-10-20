# ============================================================
# backend/app/services/portfolio_calc.py — 持仓计算（portfolio-calc.ts 的 Python 版）
# ============================================================
# 这是 TS 唯一计算入口 src/lib/portfolio-calc.ts 的逐函数移植。
# 铁律：输出必须和 TS 版逐字段一致，验收工具是 scripts/calc_parity.py。
#
# ⚠ 移植时踩到/要防的语义差异（前端视角）：
#   1. Math.round 是「四舍五入、.5 向上」（Math.round(-2.5) === -2），
#      Python 内置 round() 是「银行家舍入」（round(-2.5) === -2 但 round(2.5) === 2 💣）
#      → 必须自己实现 js_round = floor(x + 0.5)
#   2. JS 的 parseFloat("12abc") === 12（能解析前缀就行），Python 的 float() 直接抛异常
#      → js_parse_float 要模拟前缀解析
#   3. Python 的 int/float 除法、加减乘除都是 IEEE 754 双精度，和 JS 一致，这部分可以放心
#   4. dict 里「字段不存在」和「字段为 None」在 JS 里都是 undefined，要统一按 undefined 处理

import math
import re
from typing import Any

# 港币转人民币默认回落值（对应 stockUtils.ts 的 HKD_TO_CNY）
HKD_TO_CNY = 0.86

# 运行时汇率（对应 TS 侧的模块级 _hkdRate）
_hkd_rate: float = HKD_TO_CNY

# 港股代码：恰好 5 位数字（对应 /^\d{5}$/，注意 3 位的 '700' 不算港股）
_HK_RE = re.compile(r"^\d{5}$")


def set_hkd_rate(rate: Any) -> bool:
    """注入实时港币汇率（合理区间 0.75~0.98，防脏数据）——对应 TS setHkdRate"""
    global _hkd_rate
    ok = isinstance(rate, (int, float)) and not isinstance(rate, bool) and math.isfinite(rate)
    if ok and 0.75 <= rate <= 0.98:
        _hkd_rate = float(rate)
        return True
    return False


def get_hkd_rate() -> float:
    return _hkd_rate


def is_hk_stock(code: str) -> bool:
    """港股判定：恰好 5 位数字（'01810' ✓ / '600036' ✗ / '700' ✗）"""
    return bool(_HK_RE.match(str(code)))


def get_exchange_rate(code: str) -> float:
    """汇率乘数：港股 → 实时 HKD 汇率，A 股 → 1"""
    return _hkd_rate if is_hk_stock(code) else 1.0


# ─── JS 语义工具 ───────────────────────────────────────────

_FLOAT_PREFIX = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")


def js_parse_float(v: Any) -> float | None:
    """模拟 JS parseFloat：能解析数字前缀就返回，否则 NaN（这里用 None 表示）"""
    if isinstance(v, bool):
        # JS: parseFloat(true) === NaN（Number(true) 才是 1）
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    if v is None:
        return None
    m = _FLOAT_PREFIX.match(str(v))
    if not m:
        return None
    try:
        val = float(m.group(0))
    except ValueError:
        return None
    return val if math.isfinite(val) else None


def num_or(v: Any, fallback: float) -> float:
    """数字安全转换：非法值一律回落（对应 TS 的 numOr，从根源拦截 NaN）"""
    n = js_parse_float(v)
    return n if n is not None else fallback


def js_round(v: float) -> int:
    """对应 JS Math.round：.5 向 +∞ 取整（floor(x+0.5)），不用 Python 的银行家舍入"""
    return math.floor(v + 0.5)


def r2(v: float) -> float:
    """保留 2 位小数，和 TS 里 const r2 = (v) => Math.round(v * 100) / 100 一致"""
    return js_round(v * 100) / 100


def _defined(raw: dict, *keys: str) -> Any:
    """按顺序取第一个非 None 的字段（对应 JS 的 a ?? b ?? c）"""
    for k in keys:
        if k in raw and raw[k] is not None:
            return raw[k]
    return None


# ─── 字段归一化 ────────────────────────────────────────────

def normalize_position(raw: dict, fallback_id: str | None = None) -> dict | None:
    """
    归一化持仓：兼容 localStorage（stockCode/buyPrice/totalCost）
    和银河同步 json（code/price/cost）两种格式；坏数据返回 None。
    """
    if not isinstance(raw, dict):
        return None

    stock_code = str(_defined(raw, "stockCode", "code") or "").strip()
    shares = num_or(raw.get("shares"), 0)
    if not stock_code or shares <= 0:
        return None

    buy_price = num_or(_defined(raw, "buyPrice", "price"), 0)
    # 总成本优先 totalCost；否则 cost×shares（json 的 cost 是每股成本）；最后 buyPrice×shares
    total_cost_direct = num_or(raw.get("totalCost"), 0)
    cost_per_share = num_or(raw.get("cost"), 0)
    if total_cost_direct > 0:
        total_cost = total_cost_direct
    elif cost_per_share > 0:
        total_cost = cost_per_share * shares
    else:
        total_cost = buy_price * shares

    divs = raw.get("dividends")
    dividends = []
    if isinstance(divs, list):
        for d in divs:
            if not isinstance(d, dict):
                continue
            # TS: Number.isFinite(numOr(d.total, NaN)) —— 也就是 total 必须能解析成数字
            if js_parse_float(d.get("total")) is not None:
                dividends.append(d)

    # 基准股数：缺省（老数据）= 当前股数（视为未补仓）；倒挂（> shares）钳到 shares
    raw_base = num_or(raw.get("baseShares"), 0)
    base_shares = raw_base if (raw_base > 0 and raw_base <= shares) else shares
    last_add_price = num_or(raw.get("lastAddPrice"), 0)

    return {
        "id": str(_defined(raw, "id") if _defined(raw, "id") is not None
                  else (fallback_id if fallback_id is not None else f"{stock_code}_{_js_num_str(shares)}")),
        "stockCode": stock_code,
        "stockName": str(_defined(raw, "stockName") or stock_code),
        "shares": shares,
        "buyPrice": buy_price if buy_price > 0 else total_cost / shares,
        "totalCost": total_cost,
        "dividends": dividends,
        "baseShares": base_shares,
        **({"lastAddPrice": last_add_price} if last_add_price > 0 else {}),
    }


def _js_num_str(v: float) -> str:
    """JS 数字转字符串：整数值不带 .0（700 而不是 700.0）"""
    return str(int(v)) if float(v).is_integer() else repr(v)


def normalize_positions(lst: Any) -> list[dict]:
    """批量归一化（过滤坏数据），fallbackId 规则对应 TS 的 pos_${i}"""
    if not isinstance(lst, list):
        return []
    out = []
    for i, raw in enumerate(lst):
        p = normalize_position(raw, f"pos_{i}")
        if p is not None:
            out.append(p)
    return out


# ─── 单持仓指标 ────────────────────────────────────────────

def calc_position_metrics(pos: dict, stock_data: dict | None = None) -> dict:
    """单持仓盈亏/市值/成本股息率（对应 TS calcPositionMetrics）"""
    rate = get_exchange_rate(pos["stockCode"])
    quote = (stock_data or {}).get("quote") or {}
    fundamentals = (stock_data or {}).get("fundamentals") or {}

    current_price = num_or(quote.get("currentPrice"), pos["buyPrice"])
    dividend_yield = fundamentals.get("dividendYield")
    # TS 里 undefined 传进来就是 undefined；显式 null 也当没有
    if dividend_yield is not None:
        dividend_yield = num_or(dividend_yield, 0) if js_parse_float(dividend_yield) is not None else None

    shares = pos["shares"]
    market_value = shares * current_price * rate
    total_dividends = sum(num_or(d.get("total"), 0) for d in pos["dividends"]) * rate
    total_cost_cny = pos["totalCost"] * rate
    real_cost = total_cost_cny - total_dividends
    total_profit = market_value + total_dividends - total_cost_cny

    # 成本股息率：年化每股分红(¥) / 每股真实成本(¥)
    cost_yield = 0.0
    if dividend_yield is not None and dividend_yield > 0 and real_cost > 0 and shares > 0:
        annual_dps = (dividend_yield / 100) * current_price * rate
        cost_yield = (annual_dps / (real_cost / shares)) * 100

    return {
        "currentPrice": r2(current_price * rate),
        "marketValue": r2(market_value),
        "totalProfit": r2(total_profit),
        "totalProfitPct": js_round((total_profit / total_cost_cny) * 10000) / 100 if total_cost_cny > 0 else 0,
        "totalDividends": r2(total_dividends),
        "realCost": r2(real_cost),
        "realCostPerShare": r2(real_cost / shares) if shares > 0 else 0,
        "costYield": r2(cost_yield),
    }


# ─── 组合汇总（全组合唯一口径）─────────────────────────────

def calc_portfolio_summary(positions: list[dict], stock_data_map: dict[str, dict]) -> dict:
    """组合汇总：含年化分红与成本股息率（对应 TS calcPortfolioSummary）"""
    total_invested = 0.0
    total_market_value = 0.0
    total_dividends = 0.0
    annual_dividend_income = 0.0

    for pos in positions:
        stock_data = stock_data_map.get(pos["stockCode"])
        m = calc_position_metrics(pos, stock_data)
        rate = get_exchange_rate(pos["stockCode"])

        total_invested += pos["totalCost"] * rate
        total_market_value += m["marketValue"]
        total_dividends += m["totalDividends"]

        fundamentals = (stock_data or {}).get("fundamentals") or {}
        dy = fundamentals.get("dividendYield")
        if dy is not None and js_parse_float(dy) is not None and num_or(dy, 0) > 0:
            annual_dividend_income += m["marketValue"] * (num_or(dy, 0) / 100)

    total_profit = total_market_value + total_dividends - total_invested
    return {
        "totalInvested": r2(total_invested),
        "totalMarketValue": r2(total_market_value),
        "totalDividends": r2(total_dividends),
        "totalProfit": r2(total_profit),
        "totalProfitPct": js_round((total_profit / total_invested) * 10000) / 100 if total_invested > 0 else 0,
        "annualDividendIncome": r2(annual_dividend_income),
        "dividendYieldOnCost": (
            js_round((annual_dividend_income / total_invested) * 10000) / 100
            if total_invested > 0 else 0
        ),
        "positionCount": len(positions),
    }
