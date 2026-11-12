# ============================================================
# test_advice_valuation_driven.py — 补仓建议必须估值驱动，成本价不参与触发
# ------------------------------------------------------------
# 两处改造各锁一组：
#
# 【A】补仓闸门从成本锚改为估值驱动
#   旧: if cost_diff_pct < -10: 才进入补仓评估
#   → 失真：估值分位 5% 的票只要高于成本就永不提示补仓；
#           跌破成本 10% 的高估票反而先被拉进补仓评估。
#
# 【B】PE 口径必须与 pe_median_5y 同源
#   estimate_fair_value = price × (PE中位数 ÷ 当前PE)，中位数来自估值缓存。
#   若当前 PE 取自行情源（港股腾讯常给 Non-GAAP），两个口径混除结论会反过来。
#   实测阿里：行情 PE 16.2 vs 缓存 PE 23.95 → 同一票算出「便宜 28.8%」和「贵 5.3%」。
#
# 测试夹具全部虚构（888001/1000 股 @10 元），leak_guard 会拦真实持仓。
# ============================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

from portfolio_advice import analyze_position


def _pos(**kw):
    base = {"stockCode": "888001", "stockName": "测试股", "shares": 1000, "cost": 10.0}
    base.update(kw)
    return base


def _val(pe=20.0, pe_med=20.0, pb=2.0, pb_med=2.0, pct=30.0):
    """构造估值缓存条目。pct 同时写进 5y/10y 分位，保证 blend_pct == pct。"""
    return {
        "code": "888001",
        "pe_ttm": pe,
        "pe_median_5y": pe_med,
        "pb": pb,
        "pb_median_5y": pb_med,
        "pe_pct_5y": pct,
        "pe_pct_10y": pct,
        "pb_pct_5y": pct,
        "pb_pct_10y": pct,
    }


def _actions(result):
    ops = (result.get("adviceSummary") or {}).get("costAdvice") or []
    return [o.get("action", "") for o in ops], ops


# ── A 组：补仓闸门不看成本价 ──────────────────────────────

def test_浮盈但估值便宜_仍应提示补仓():
    """旧逻辑的盲区：现价高于成本价（浮盈 20%）时 cost_diff_pct>=-5，永远走不到补仓分支。
    新逻辑下只要估值便宜就该提示补仓 —— 成本价是沉没成本，不影响「现在贵不贵」。"""
    pos = _pos(cost=10.0)                       # 成本 10
    quote = {"price": 12.0, "name": "测试股", "pe": 20.0}   # 现价 12 → 浮盈 20%
    val = _val(pe=12.0, pe_med=20.0, pct=20.0)  # 分位 20%，合理估值 12×(20/12)=20 > 现价
    result = analyze_position(pos, quote, val)
    actions, _ = _actions(result)
    assert "补仓" in actions, f"估值便宜却因浮盈不给补仓建议，动作={actions}"


def test_跌破成本但估值贵_不给补仓建议():
    """旧逻辑的另一个盲区：跌破成本 30% 会先进入补仓评估（再被估值否决）。
    新逻辑分位 ≥50 直接不给补仓建议，避免「跌了就补」的错误暗示。"""
    pos = _pos(cost=10.0)
    quote = {"price": 7.0, "name": "测试股", "pe": 40.0}    # 跌破成本 30%
    val = _val(pe=40.0, pe_med=20.0, pct=85.0)              # 分位 85%，贵
    result = analyze_position(pos, quote, val)
    actions, _ = _actions(result)
    assert not any("补" in a for a in actions), f"估值贵却在提示补仓，动作={actions}"
    assert "不建议补仓" not in actions, "分位高应该沉默，不该给补仓类结论"


def test_分位低但现价高于合理估值_暂缓补仓():
    """阿里的真实情形：分位 45%（看起来便宜），但现价仍高于 PE 中位数反推的合理估值。
    分位低不等于价格便宜，必须两个条件同时满足才建议补。"""
    pos = _pos(cost=100.0)
    quote = {"price": 95.0, "name": "测试股", "pe": 24.0}
    val = _val(pe=24.0, pe_med=22.0, pct=45.0)   # 合理估值 95×(22/24)=87.1 < 现价 95
    result = analyze_position(pos, quote, val)
    actions, ops = _actions(result)
    assert "暂缓补仓" in actions, f"现价高于合理估值不该建议补仓，动作={actions}"
    reason = next(o["reason"] for o in ops if o.get("action") == "暂缓补仓")
    assert "合理估值" in reason and "安全边际" in reason
    assert "成本" not in reason.replace("成本价", ""), "理由里不该再拿成本价说事"


def test_分位低且跌破合理估值_建议补仓():
    pos = _pos(cost=10.0)
    quote = {"price": 8.0, "name": "测试股", "pe": 12.0}
    val = _val(pe=12.0, pe_med=20.0, pct=25.0)   # 合理估值 8×(20/12)=13.3 > 现价 8
    result = analyze_position(pos, quote, val)
    actions, ops = _actions(result)
    assert "补仓" in actions
    reason = next(o["reason"] for o in ops if o.get("action") == "补仓")
    assert "合理估值" in reason
    assert "摊低成本" not in reason, "补仓理由不能出现成本锚话术"


# ── B 组：PE 口径同源 ────────────────────────────────────

def test_合理估值用缓存PE而非行情PE():
    """行情 PE 16 / 缓存 PE 24、中位数 22：
    同源算 95×(22/24)=87.1；混用算 95×(22/16)=130.6。取前者。"""
    pos = _pos(cost=100.0)
    quote = {"price": 95.0, "name": "测试股", "pe": 16.0}
    val = _val(pe=24.0, pe_med=22.0, pct=45.0)
    result = analyze_position(pos, quote, val)
    assert abs(result["fairValue"] - 87.1) < 0.5, f"用了行情 PE 算合理估值：{result['fairValue']}"
    assert result["pe"] == 24.0, "对外展示的 PE 也应与中位数同源"


def test_无缓存PE时对行情PE兜底():
    pos = _pos(cost=10.0)
    quote = {"price": 8.0, "name": "测试股", "pe": 15.0}
    val = _val(pe=15.0, pe_med=20.0, pct=30.0)
    val["pe_ttm"] = None          # 缓存没有 PE
    result = analyze_position(pos, quote, val)
    assert result["pe"] == 15.0, "缓存缺 PE 时应回落到行情 PE"
    assert result["fairValue"] is not None
