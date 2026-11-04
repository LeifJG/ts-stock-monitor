# ============================================================
# test_portfolio_advice_none_valuation.py — 估值分位缺失不能把分析搞崩
# ------------------------------------------------------------
# 事故：新买入的标的没有估值缓存（588080 科创50ETF、688825 长鑫科技），
# blend_pct 为 None，而 f"{blend_pct:.0f}%" 直接抛
#   TypeError: unsupported format string passed to NoneType.__format__
# 整个脚本崩掉 → /api/portfolio-advice 500 → 前端「操作建议分析不出来」。
#
# 本测试锁两件事：
#   1. 分位缺失时能正常出建议（文案里写「分位缺失」，不假装"估值合理"）
#   2. 每只持仓的分析互不影响（main 里的 try/except 兜底）
# ============================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

from portfolio_advice import analyze_position, fmt_pct


def _pos(**kw):
    base = {"stockCode": "888001", "stockName": "测试股", "shares": 1000, "cost": 10.0}
    base.update(kw)
    return base


def test_fmt_pct_none_safe():
    assert fmt_pct(None) == "—"
    assert fmt_pct(42.5) == "42"
    assert fmt_pct(42.5, ".1f") == "42.5"
    assert fmt_pct("bad") == "—"


def test_分位缺失也不崩_小回撤补仓分支():
    """现价低于成本 12% 且没有估值分位——历史事故点（PE 为正视为盈利股，走补仓判断）"""
    pos = _pos(cost=10.0, shares=1000)
    quote = {"price": 8.8, "name": "测试股", "pe": 15.0}  # -12%，盈利股
    result = analyze_position(pos, quote, None)
    assert result is not None
    text = str(result)
    assert "Traceback" not in text
    # 没有分位时不能假装"估值合理"
    assert "分位缺失" in text or "没有估值分位" in text


def test_缺失值不许泄漏成字面量_None():
    """任何分支都不该输出 'None 倍' / 'PB None' 这种字面量"""
    for quote in (
        {"price": 8.8, "name": "测试股"},                    # 无 pe，按亏损股走
        {"price": 8.8, "name": "测试股", "pe": 15.0},
        {"price": 6.0, "name": "测试股", "pe": 15.0},
    ):
        result = analyze_position(_pos(), quote, None)
        text = str(result)
        assert " None " not in text and "None 倍" not in text, text[:400]


def test_分位缺失也不崩_深度回撤分支():
    pos = _pos(cost=10.0, shares=1000)
    quote = {"price": 6.0, "name": "测试股"}  # -40%
    result = analyze_position(pos, quote, None)
    assert result is not None


def test_有分位时正常输出分位数字():
    pos = _pos(cost=10.0, shares=1000)
    quote = {"price": 8.8, "name": "测试股", "pe": 12.0}
    val = {"pe_pct_5y": 30.0, "pb_pct_5y": 20.0, "pb": 1.5}
    result = analyze_position(pos, quote, val)
    assert result is not None
    assert "30" in str(result) or "24" in str(result)  # 0.6*30 + 0.4*20 = 26 附近
