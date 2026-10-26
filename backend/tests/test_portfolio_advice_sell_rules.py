"""
卖出侧规则单测 —— 「卖出看估值，不看赚多少」

背景：旧逻辑只看 cost_diff_pct（相对成本价的浮盈百分比）：
    cost_diff_pct > 15 → 部分止盈 20-30%
    cost_diff_pct > 5  → 逢高减仓 10-15%
这导致「成本便宜 / 前期减仓摊薄成本」的持仓被反复喊止盈，而真正估值到顶的
小赚仓位反而无人提示。本测试锁定修复后的口径：

    R1 分位 ≥85 → 估值很贵，浮盈 >5% 就减（不看是否到 15%）
    R2 分位 ≥70 + 现价超合理估值 5% + 浮盈 >15% → 部分止盈
    R3 分位 <70 → 浮盈再高也只是一条「浮盈提示」，不构成卖点

夹具一律用虚构代码（888001/888002…）与圆整数值，禁止抄真实持仓。
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import portfolio_advice as pa  # noqa: E402


# ─── 股息率口径 ─────────────────────────────────────────────

def test_pick_dividend_yield_prefers_real_dps():
    """真实每股分红优先：2.016 / 42.50 = 4.74%，不得被 payout÷PE 估算的 5.66% 顶掉"""
    dy, src = pa.pick_dividend_yield(2.016, 42.50, 5.66)
    assert (dy, src) == (4.74, "cninfo")


def test_pick_dividend_yield_falls_back_to_estimate():
    """真实分红缺失（港股常见）→ 用估算兜底，并标注来源"""
    dy, src = pa.pick_dividend_yield(None, 30.0, 2.65)
    assert (dy, src) == (2.65, "estimate")


def test_pick_dividend_yield_no_source():
    dy, src = pa.pick_dividend_yield(None, 30.0, None)
    assert (dy, src) == (0.0, "none")


def test_pick_dividend_yield_zero_price():
    dy, src = pa.pick_dividend_yield(1.0, 0, 3.0)
    assert (dy, src) == (3.0, "estimate")


# ─── 卖出侧规则 ─────────────────────────────────────────────

def actions(advice_list: list) -> list:
    return [a["action"] for a in advice_list]


def find(advice_list: list, keyword: str):
    hits = [a for a in advice_list if keyword in a["action"]]
    assert hits, f"未找到含「{keyword}」的建议，实际: {actions(advice_list)}"
    return hits[0]


# ─── R3：估值不贵时，浮盈再高也不能卖 ───────────────────────

def test_high_profit_low_valuation_must_not_sell():
    """分位 35%、浮盈 90%（典型「成本低」持仓）→ 只能提示，不能止盈"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=90.0, blend_pct=35.0, window_label="10年",
        fair_value=None, current_price=100.0, shares=1000,
    )
    assert "部分止盈" not in actions(out)
    assert not any(a.startswith("卖 ") for a in actions(out))
    tip = find(out, "浮盈提示")
    assert tip["trigger"] == "仓位参考"
    assert "与估值无关" in tip["reason"]


def test_high_profit_low_valuation_below_fair_value():
    """分位低 + 现价低于合理估值 + 浮盈巨大 → 依然不卖"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=200.0, blend_pct=20.0, window_label="10年",
        fair_value=120.0, current_price=100.0, shares=500,
    )
    assert "部分止盈" not in actions(out)
    assert find(out, "浮盈提示")["trigger"] == "仓位参考"


# ─── R1：估值很高，小赚也要减（旧逻辑的真空区）─────────────

def test_very_high_valuation_small_profit_triggers_reduce():
    """分位 90%、浮盈只有 8% → 应触发「估值高位减仓」（旧逻辑完全不提示）"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=8.0, blend_pct=90.0, window_label="10年",
        fair_value=None, current_price=100.0, shares=1000,
    )
    act = find(out, "估值高位减仓")
    assert act["priority"] == "high"
    assert act["trigger"] == "估值驱动"
    assert "卖 150 股" in actions(out)  # 15% 仓位


def test_very_high_valuation_tiny_profit_only_hints():
    """分位 90% 但浮盈只有 2%（未到 5% 动手线）→ 提示不动手"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=2.0, blend_pct=90.0, window_label="10年",
        fair_value=None, current_price=100.0, shares=1000,
    )
    assert "估值高位提示" in actions(out)
    assert not any(a.startswith("卖 ") for a in actions(out))


def test_very_high_valuation_big_profit_sells_quarter():
    out = pa.evaluate_sell_advice(
        cost_diff_pct=20.0, blend_pct=92.0, window_label="10年",
        fair_value=None, current_price=100.0, shares=1000,
    )
    assert "部分止盈" in actions(out)
    assert "卖 250 股" in actions(out)


# ─── R2：偏贵需要「分位 + 超合理估值」双条件 ────────────────

def test_high_valuation_plus_above_fair_sells():
    out = pa.evaluate_sell_advice(
        cost_diff_pct=18.0, blend_pct=75.0, window_label="10年",
        fair_value=90.0, current_price=100.0, shares=1000,  # 溢价 11% > 5%
    )
    act = find(out, "部分止盈")
    assert act["trigger"] == "估值驱动"
    assert "卖 250 股" in actions(out)


def test_high_valuation_but_below_fair_does_not_sell():
    """分位 75% 偏高，但现价低于合理估值 → 不构成卖点"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=18.0, blend_pct=75.0, window_label="10年",
        fair_value=120.0, current_price=100.0, shares=1000,
    )
    assert "部分止盈" not in actions(out)
    assert find(out, "浮盈提示")["trigger"] == "仓位参考"


# ─── R3 补充：分位不高但已超历史中位数 → 小比例减 ──────────

def test_low_valuation_above_fair_must_not_sell():
    """分位 35%（不算贵）+ 溢价 10% + 浮盈 90% → 仍不卖（窗口打架的伪信号）"""
    out = pa.evaluate_sell_advice(
        cost_diff_pct=90.0, blend_pct=35.0, window_label="10年",
        fair_value=90.0, current_price=100.0, shares=1000,
    )
    assert "部分止盈" not in actions(out)
    assert find(out, "浮盈提示")["trigger"] == "仓位参考"


def test_below_high_valuation_above_fair_sells_small():
    out = pa.evaluate_sell_advice(
        cost_diff_pct=25.0, blend_pct=55.0, window_label="10年",
        fair_value=80.0, current_price=100.0, shares=1000,  # 溢价 25%
    )
    act = find(out, "部分止盈")
    assert "10-15%" in act["reason"]
    assert "卖 150 股" in actions(out)


# ─── trigger 字段完整性 ────────────────────────────────────

@pytest.mark.parametrize("cost,blend,fair", [
    (90.0, 35.0, None),
    (8.0, 90.0, None),
    (18.0, 75.0, 90.0),
    (18.0, 75.0, 120.0),
    (20.0, 55.0, 80.0),
    (0.0, 30.0, None),
])
def test_every_advice_has_trigger(cost, blend, fair):
    out = pa.evaluate_sell_advice(cost, blend, "10年", fair, 100.0, 1000)
    for a in out:
        assert a.get("trigger") in {"估值驱动", "仓位参考"}
        assert a.get("priority") in {"high", "medium", "low"}
        assert a.get("reason")


def test_no_valuation_data_does_not_crash():
    out = pa.evaluate_sell_advice(
        cost_diff_pct=30.0, blend_pct=None, window_label="全历史",
        fair_value=None, current_price=100.0, shares=100,
    )
    # 无估值数据时不得因浮盈就喊止盈
    assert "部分止盈" not in actions(out)


# ─── 合理估值锚 ─────────────────────────────────────────────

def test_fair_value_uses_pe_median_for_profit_stock():
    fv, basis = pa.estimate_fair_value(
        {"pe_median_5y": 10.0, "pb_median_5y": 2.0}, price=20.0, pe=20.0)
    assert basis == "PE 5年中位数"
    assert fv == 10.0  # 20 × (10/20)


def test_fair_value_skips_pe_for_loss_stock():
    fv, basis = pa.estimate_fair_value(
        {"pe_median_5y": -50.0, "pb_median_5y": 3.0, "pb": 6.0}, price=12.0, pe=-20.0)
    assert basis == "PB 5年中位数"
    assert fv == 6.0  # 12 × (3/6)


def test_fair_value_rejects_incomparable_pb_median():
    """PB 中位数是当前的 5 倍（基本面断代）→ 放弃出锚，不硬算"""
    fv, basis = pa.estimate_fair_value(
        {"pb_median_5y": 20.0, "pb": 4.0}, price=8.0, pe=None)
    assert fv is None and basis is None


def test_fair_value_clipped():
    fv, _ = pa.estimate_fair_value({"pe_median_5y": 20.0}, price=10.0, pe=10.0)
    assert fv == 20.0  # 比值 2.0（边界内），夹在 2x 现价以内


def test_fair_value_rejects_incomparable_pe_ratio():
    """PE 中位数是当前 10 倍（盈利暴增）→ PE 锚失效，且无 PB 可退回 → None"""
    fv, basis = pa.estimate_fair_value({"pe_median_5y": 100.0}, price=10.0, pe=10.0)
    assert fv is None and basis is None


def test_fair_value_pe_ratio_out_of_range_falls_back_to_pb():
    fv, basis = pa.estimate_fair_value(
        {"pe_median_5y": 100.0, "pb_median_5y": 1.2, "pb": 1.0}, price=10.0, pe=10.0)
    assert basis == "PB 5年中位数"
    assert fv == 12.0


def test_fair_value_missing_data():
    assert pa.estimate_fair_value(None, price=10.0, pe=10.0) == (None, None)
    assert pa.estimate_fair_value({}, price=0, pe=10.0) == (None, None)


# ─── 端到端：analyze_position 组装（虚构代码）──────────────

def _pos(code="888001", shares=1000, cost=10.0):
    return {"stockCode": code, "stockName": "测试股", "shares": shares,
            "buyPrice": cost, "totalCost": cost * shares, "buyDate": "", "dividends": []}


def _quote(code="888001", price=30.0, pe=7.0):
    return {"name": "测试股", "price": price, "prevClose": price, "changePercent": 0.0,
            "high": price, "low": price, "pe": pe, "roe": 15.0, "dividendYield": 2.0}


def test_analyze_position_low_valuation_high_profit_no_sell():
    val = {"pe_ttm": 7.0, "pb": 0.9, "pe_median_5y": 7.2, "pb_median_5y": 0.95,
           "pe_pct_10y": 35.0, "pb_pct_10y": 20.0}
    r = pa.analyze_position(_pos(cost=10.0), _quote(price=30.0), val)
    assert r is not None
    assert r["costProfitPct"] == pytest.approx(200.0)
    assert r["valuationPct"] == pytest.approx(29.0)  # 0.6×35 + 0.4×20
    assert r["valuationWindow"] == "10年"
    assert r["fairValueBasis"] == "PE 5年中位数"
    acts = [o["action"] for o in r["operations"]]
    assert "部分止盈" not in acts
    assert all(o.get("trigger") for o in r["operations"])


def test_analyze_position_very_high_valuation_does_sell():
    val = {"pe_ttm": 30.0, "pb": 3.0, "pe_median_5y": 20.0, "pb_median_5y": 2.0,
           "pe_pct_10y": 92.0, "pb_pct_10y": 88.0}
    r = pa.analyze_position(_pos(cost=10.0), _quote(price=30.0, pe=30.0), val)
    acts = [o["action"] for o in r["operations"]]
    assert any("减仓" in a or "部分止盈" in a for a in acts), acts
    assert any(o["trigger"] == "估值驱动" for o in r["operations"])


def test_holding_advice_kept_when_no_sell():
    """浮盈高但估值不贵（招行式：分位 29% + 成本股息率 9%）→ 保留「持有收息」，不误判成卖出"""
    val = {"pe_ttm": 7.0, "pb": 0.9, "pe_median_5y": 6.6, "pb_median_5y": 0.8,
           "pe_pct_10y": 35.0, "pb_pct_10y": 20.0}
    q = _quote(price=30.0, pe=7.0)
    q["dividendYield"] = 9.0
    r = pa.analyze_position(_pos(cost=10.0), q, val)
    ops = [o["action"] for o in r["operations"]]
    assert not any(a.startswith("卖 ") or "止盈" in a for a in ops), ops
    assert "持有收息" in ops
    div_actions = {a["action"]: a for a in r["adviceSummary"]["dividendAdvice"]}
    assert div_actions["持有收息"]["priority"] == "high"


def test_holding_advice_demoted_when_sell_exists():
    """卖出成立时，不再并列「持有收息」——否则报告自相矛盾无法执行"""
    val = {"pe_ttm": 30.0, "pb": 3.0, "pe_median_5y": 20.0, "pb_median_5y": 2.0,
           "pe_pct_10y": 92.0, "pb_pct_10y": 88.0}
    q = _quote(price=30.0, pe=30.0)
    q["dividendYield"] = 9.0  # 成本股息率会 >8% → 触发「持有收息」
    r = pa.analyze_position(_pos(cost=10.0), q, val)
    ops = [o["action"] for o in r["operations"]]
    assert any("减仓" in a or "部分止盈" in a for a in ops), ops
    assert "持有收息" not in ops
    div_actions = {a["action"]: a for a in r["adviceSummary"]["dividendAdvice"]}
    assert div_actions["持有收息"]["priority"] == "info"
