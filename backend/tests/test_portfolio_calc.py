# ============================================================
# backend/tests/test_portfolio_calc.py — 持仓计算移植版单测
# ============================================================
# 重点不是「算得对不对」，而是「和 TS 算得一模一样」。
# 这些用例锁定的是 JS 与 Python 的语义差异点，改代码时一旦破坏就会红。
#
# 跑法：cd backend && .venv/bin/python3 -m pytest tests/test_portfolio_calc.py -v
# 完整一致性验收（含 TS 基准比对）：.venv/bin/python3 ../scripts/calc_parity.py

import math

import pytest

from app.services import portfolio_calc as pc


# ── JS 语义：舍入 ───────────────────────────────────────────
def test_js_round_half_up_matches_js():
    # JS Math.round 是 .5 向上；Python 内置 round 是银行家舍入，这里是关键差异
    assert pc.js_round(0.5) == 1
    assert pc.js_round(1.5) == 2
    assert pc.js_round(2.5) == 3      # Python round(2.5) == 2 💣
    assert pc.js_round(-2.5) == -2    # JS Math.round(-2.5) === -2
    assert pc.js_round(-0.5) == 0
    assert pc.js_round(500.5) == 501  # Python round(500.5) == 500 💣


def test_r2_rounding_ties():
    # 5.005 → ×100 = 500.5 → JS 501 → 5.01（Python round 会得到 5.0）
    assert pc.r2(5.005) == 5.01
    assert pc.r2(0.905) == 0.91
    assert pc.r2(312.5 / 10000) == 0.03


# ── JS 语义：parseFloat ────────────────────────────────────
def test_js_parse_float_accepts_prefix():
    assert pc.js_parse_float("12.5abc") == 12.5   # Python float("12.5abc") 会抛异常
    assert pc.js_parse_float("  7 ") == 7.0
    assert pc.js_parse_float("abc") is None
    assert pc.js_parse_float(None) is None
    assert pc.js_parse_float(True) is None        # JS parseFloat(true) === NaN
    assert pc.js_parse_float(float("inf")) is None


def test_num_or_falls_back():
    assert pc.num_or("abc", 9.9) == 9.9
    assert pc.num_or(None, 1.5) == 1.5
    assert pc.num_or("3.14", 0) == 3.14


# ── 港股判定：必须恰好 5 位 ─────────────────────────────────
def test_is_hk_stock():
    assert pc.is_hk_stock("01111") is True
    assert pc.is_hk_stock("00700") is True
    assert pc.is_hk_stock("700") is False        # 3 位短码不算港股（与 TS 一致）
    assert pc.is_hk_stock("888001") is False
    assert pc.is_hk_stock("0181") is False


def test_exchange_rate():
    assert pc.set_hkd_rate(0.8563) is True
    assert pc.get_exchange_rate("01111") == 0.8563
    assert pc.get_exchange_rate("888001") == 1
    # 超出合理区间的脏数据要拒收
    assert pc.set_hkd_rate(1.5) is False
    assert pc.set_hkd_rate(0.5) is False
    assert pc.set_hkd_rate("0.86") is False
    pc.set_hkd_rate(0.86)  # 复原


# ── 归一化 ─────────────────────────────────────────────────
def test_normalize_localStorage_format():
    p = pc.normalize_position({
        "id": "p1", "stockCode": "888001", "stockName": "虚构A股一",
        "shares": 300, "buyPrice": 11.11, "totalCost": 3333,
    })
    assert p["stockCode"] == "888001"
    assert p["totalCost"] == 3333
    assert p["baseShares"] == 300          # 老数据 baseShares 缺省 = shares
    assert "lastAddPrice" not in p


def test_normalize_sync_json_format():
    # 银河同步格式：code / cost（每股成本），没有 totalCost
    p = pc.normalize_position({"code": "02222", "shares": 400, "cost": 33.33})
    assert p["stockCode"] == "02222"
    assert p["totalCost"] == pytest.approx(33.33 * 400)


def test_normalize_totalcost_fallback_chain():
    # totalCost 缺失且 cost 缺失 → buyPrice × shares
    p = pc.normalize_position({"stockCode": "888006", "shares": 150, "buyPrice": 55.55})
    assert p["totalCost"] == pytest.approx(55.55 * 150)


def test_normalize_drops_bad_records():
    assert pc.normalize_position({"stockCode": "", "shares": 100}) is None
    assert pc.normalize_position({"stockCode": "888004", "shares": 0}) is None
    assert pc.normalize_positions("not a list") == []
    assert len(pc.normalize_positions([
        {"stockCode": "888004", "shares": 0},
        {"stockCode": "888005", "shares": 300, "buyPrice": 28.6},
    ])) == 1


def test_normalize_baseshares_clamped():
    # baseShares > shares 属倒挂，钳到 shares
    p = pc.normalize_position({"stockCode": "888003", "shares": 100, "buyPrice": 55.5, "baseShares": 300})
    assert p["baseShares"] == 100
    # 正常补仓场景保留
    p2 = pc.normalize_position({"stockCode": "01111", "shares": 800, "buyPrice": 12.5,
                                "baseShares": 600, "lastAddPrice": 11.0})
    assert p2["baseShares"] == 600
    assert p2["lastAddPrice"] == 11.0


# ── 指标计算 ───────────────────────────────────────────────
def test_position_metrics_standard():
    p = pc.normalize_position({
        "stockCode": "888001", "shares": 300, "buyPrice": 11.11, "totalCost": 3333,
        "dividends": [{"total": 120}, {"total": 150}],
    })
    m = pc.calc_position_metrics(p, {
        "quote": {"currentPrice": 13.5}, "fundamentals": {"dividendYield": 5.0},
    })
    assert m["marketValue"] == 300 * 13.5
    assert m["totalDividends"] == 270
    assert m["totalProfit"] == 300 * 13.5 + 270 - 3333          # 市值 + 分红 - 投入
    assert m["realCost"] == 3333 - 270            # 投入 - 分红
    assert m["realCostPerShare"] == 10.21


def test_position_metrics_no_quote_falls_back_to_buy_price():
    p = pc.normalize_position({"stockCode": "888002", "shares": 100, "buyPrice": 25.5, "totalCost": 2550})
    m = pc.calc_position_metrics(p, None)
    assert m["marketValue"] == 2550
    assert m["totalProfit"] == 0


def test_position_metrics_hk_rate_applied():
    pc.set_hkd_rate(0.8563)
    p = pc.normalize_position({"stockCode": "01111", "shares": 800, "buyPrice": 12.5,
                               "totalCost": 10000})
    m = pc.calc_position_metrics(p, {"quote": {"currentPrice": 15.2}})
    assert m["marketValue"] == pytest.approx(800 * 15.2 * 0.8563, abs=0.01)
    pc.set_hkd_rate(0.86)


# ── 组合汇总 ───────────────────────────────────────────────
def test_portfolio_summary_counts():
    positions = pc.normalize_positions([
        {"stockCode": "888001", "shares": 300, "buyPrice": 11.11, "totalCost": 3333},
        {"stockCode": "888002", "shares": 100, "buyPrice": 25.5},
    ])
    s = pc.calc_portfolio_summary(positions, {
        "888001": {"quote": {"currentPrice": 13.5}, "fundamentals": {"dividendYield": 5.0}},
        "888002": {"quote": {"currentPrice": 26.8}, "fundamentals": {"dividendYield": 4.0}},
    })
    assert s["positionCount"] == 2
    assert s["totalInvested"] == pytest.approx(3333 + 25.5 * 100, abs=0.01)
    assert s["totalMarketValue"] == pytest.approx(300 * 13.5 + 26.8 * 100, abs=0.01)
    # 年化分红 = Σ 市值 × 股息率
    expected_annual = (300 * 13.5) * 0.05 + (26.8 * 100) * 0.04
    assert s["annualDividendIncome"] == pytest.approx(expected_annual, abs=0.02)


def test_portfolio_summary_empty():
    s = pc.calc_portfolio_summary([], {})
    assert s["positionCount"] == 0
    assert s["totalProfitPct"] == 0
    assert s["dividendYieldOnCost"] == 0
