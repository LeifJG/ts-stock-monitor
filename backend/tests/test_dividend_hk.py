"""
港股分红/回购口径单测

背景：
  1. cninfo（巨潮）只有 A 股分红，港股取不到 → 「股东回报」维度恒 0，
     腾讯/阿里/小米护城河评级被系统性低估。
  2. 小米 01810 从不分红，若放任它回落到 payout÷PE 估算，会凭空算出 ~3% 股息率。

锁定：
  - 港股分红走东财港股分红派息，多币种统一折港币（优先用公告自带的港币折算值）
  - 「确认无分红」与「取数失败」必须区分：前者给 0，后者才允许用估算
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import pytest  # noqa: E402

import dividend_data as dd  # noqa: E402
import portfolio_advice as pa  # noqa: E402


# ─── 港股分红文案解析 ─────────────────────────────────────────

@pytest.mark.parametrize("text, expected", [
    ("每股派港币0.12元", 0.12),
    ("每股派港元2.30元", 2.30),
    ("每股派美元0.125元(相当于港币0.97641元(计算值))", 0.97641),   # 优先用公告自带折算
    ("每股派人民币1.50元", 1.635),                                # 人民币 ×1.09
    ("每股派美元0.10元", 0.78),                                   # 美元 ×7.8
])
def test_parse_hk_dividend_amount_amounts(text, expected):
    got = dd.parse_hk_dividend_amount(text)
    assert got is not None
    assert abs(got - expected) < 1e-4


@pytest.mark.parametrize("text", ["", "nan", "不派息", "None", None])
def test_parse_hk_dividend_amount_empty(text):
    assert dd.parse_hk_dividend_amount(text) is None


# ─── 港股代码识别 ─────────────────────────────────────────────

def test_is_hk_code():
    assert dd.is_hk_code("00700") is True
    assert dd.is_hk_code("09988") is True
    assert dd.is_hk_code("600519") is False   # A 股 6 位
    assert dd.is_hk_code("") is False


# ─── 股息率口径：确认无分红不吃估算 ───────────────────────────

def test_pick_dividend_yield_confirmed_zero_ignores_estimate():
    """港股确认无分红（dps=0）→ 必须输出 0，不能落回估算 3%"""
    dy, src = pa.pick_dividend_yield(0.0, 25.0, 3.10)
    assert (dy, src) == (0.0, "none")


def test_pick_dividend_yield_hk_real_dps():
    """港股真实分红（港币/股）÷ 港币股价"""
    dy, src = pa.pick_dividend_yield(5.3, 386.8, 1.9)
    assert src == "cninfo"
    assert dy == pytest.approx(1.37, abs=1e-2)


# ─── 股东回报维度：回购计入 ───────────────────────────────────

def test_shareholder_return_includes_buyback():
    """分红率低但大额回购的公司不该是 0 分（腾讯/小米这类）"""
    import moat_data as md
    # 无分红，回购 2.5%/年，PE 20 → 回购等价分红率 50% → 8 分；股东总收益率 2.5% <3 → 0 分
    score, facts = md.score_shareholder_return(None, 100.0, None, 2.5, 20.0)
    assert score == 8
    assert facts["buybackEquivPayout"] == 50.0
    assert facts["shareholderYield"] == 2.5


def test_shareholder_return_dividend_only_unchanged():
    """A 股口径不受影响：分红率 68% + 股息率 3.4% → 10 + 3 = 13"""
    import moat_data as md
    score, facts = md.score_shareholder_return(3.4, 100.0, 68.0)
    assert score == 13
    assert "buybackPct" not in facts
