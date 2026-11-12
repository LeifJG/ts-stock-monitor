# ============================================================
# test_quality_gate.py — 质量闸门：便宜 ≠ 该买
# ------------------------------------------------------------
# 规则：护城河评级 / ROIC 跑赢资金成本年数 / 股东总回报 三维投票，
#       两项差 → grade=poor。补仓建议降级为 medium 且单批额度减半。
#
# 为什么必须三维而不是单一 ROIC 阈值（真实持仓里的反例）：
#   · 长江电力 ROIC 5.1% 很低，但护城河评级「宽」（水电资本密集，天生低）
#   · 招商银行 ROIC 口径不适用（银行看 ROE）
# 只看 ROIC 会把这两类误判成烂公司。
#
# 测试夹具虚构（888001/1000 股 @10 元），leak_guard 会拦真实持仓。
# ============================================================

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

import portfolio_advice as pa


def _moat(rating, score, years_above=5, share_yield=4.0, gm_trend=1.0):
    return {
        "code": "888001",
        "score": score,
        "rating": rating,
        "ratingLabel": {"wide": "宽护城河", "narrow": "窄护城河", "none": "无护城河"}[rating],
        "dims": {
            "盈利持续性": {"score": 25, "max": 30, "years_above_wacc": years_above, "roic_avg5": 9.0},
            "定价权": {"score": 20, "max": 25, "gm_trend": gm_trend, "gm_latest": 40.0},
            "股东回报": {"score": 10, "max": 15, "shareholderYield": share_yield, "dividendYield": share_yield},
        },
    }


@pytest.fixture
def fake_caches(monkeypatch):
    """注入虚构缓存，避免测试依赖 data/ 下的真实文件"""
    def _install(moat_entry, fin_entry):
        monkeypatch.setattr(pa, "_QUALITY_CACHE", ({"888001": moat_entry}, {"888001": fin_entry}))
    return _install


def _pos():
    return {"stockCode": "888001", "stockName": "测试股", "shares": 1000, "cost": 10.0}


def _val(pct=25.0, pe=12.0, pe_med=20.0):
    return {"pe_ttm": pe, "pe_median_5y": pe_med, "pb": 2.0, "pb_median_5y": 2.0,
            "pe_pct_5y": pct, "pe_pct_10y": pct, "pb_pct_5y": pct, "pb_pct_10y": pct}


def _acts(result):
    return [(o["action"], o["reason"]) for o in result["adviceSummary"]["costAdvice"]]


# ── 三维投票 ────────────────────────────────────────────

def test_宽护城河_低ROIC仍判合格(fake_caches):
    """长江电力式的公司：ROIC 只有 5.1% 但护城河宽、回报稳定 → 不应被判质量不合格"""
    fake_caches(_moat("wide", 79, years_above=5, share_yield=3.37), {"roic": 5.1})
    q = pa.evaluate_quality("888001")
    assert q["grade"] == "good", f"宽护城河被误判：{q}"


def test_无护城河_低ROIC低回报判不合格(fake_caches):
    """阿里式的公司：无护城河 + 5 年只有 1 年跑赢资金成本 → poor"""
    fake_caches(_moat("none", 48, years_above=1, share_yield=1.14, gm_trend=-17.4), {"roic": 6.3})
    q = pa.evaluate_quality("888001")
    assert q["grade"] == "poor"
    assert any("跑赢资金成本" in w for w in q["warnings"])
    assert any("非收息" in w for w in q["warnings"])
    assert any("毛利率" in w for w in q["warnings"])


def test_无护城河但ROIC达标_判中性(fake_caches):
    """小米式：评级无护城河，但 ROIC 10.9%、3 年跑赢、回报 2.53% → 只有一维差，fair"""
    fake_caches(_moat("none", 44, years_above=3, share_yield=2.53, gm_trend=9.0), {"roic": 10.9})
    q = pa.evaluate_quality("888001")
    assert q["grade"] == "fair", f"只有一维差应判 fair：{q}"


def test_数据缺失返回None不编造(fake_caches):
    fake_caches({}, {})
    assert pa.evaluate_quality("888001") is None


# ── 补仓建议里的质量闸门 ────────────────────────────────

def test_质量不合格_补仓降级并减半(fake_caches):
    """便宜但烂：分位 25% + 跌破合理估值，仍应提示质量不合格、额度减半（15% 不是 30%）"""
    fake_caches(_moat("none", 20, years_above=0, share_yield=0.5), {"roic": -6.0})
    result = pa.analyze_position(_pos(), {"price": 8.0, "name": "测试股", "pe": 12.0}, _val(pct=6.0))
    acts = _acts(result)
    buy = next((a for a, r in acts if a.startswith("补仓")), None)
    assert buy and "质量不合格" in buy, f"应降级为质量不合格补仓，实际={acts}"
    assert "建议减半" in buy
    qty = next((r for a, r in acts if a.startswith("补 ")), "")
    assert "15%" in qty, f"质量不合格时单批额度应减半为 15%：{qty}"
    # priority 必须降级
    assert all(o["priority"] == "medium" for o in result["adviceSummary"]["costAdvice"]
               if o["action"].startswith("补"))


def test_质量合格_补仓正常30_percent(fake_caches):
    fake_caches(_moat("wide", 80), {"roic": 12.0})
    result = pa.analyze_position(_pos(), {"price": 8.0, "name": "测试股", "pe": 12.0}, _val(pct=25.0))
    acts = _acts(result)
    assert any(a == "补仓" for a, _ in acts)
    qty = next((r for a, r in acts if a.startswith("补 ")), "")
    assert "30%" in qty
    # 质量合格时应把护城河写进理由，作为「可补」的佐证
    reason = next(r for a, r in acts if a == "补仓")
    assert "宽护城河" in reason


def test_暂缓补仓时质量差要提示只宜小仓位(fake_caches):
    """阿里场景：分位低但现价高于合理估值 → 暂缓；同时质量差 → 说明即使跌到位也只宜小仓"""
    fake_caches(_moat("none", 48, years_above=1, share_yield=1.14, gm_trend=-17.4), {"roic": 6.3})
    result = pa.analyze_position(_pos(), {"price": 95.0, "name": "测试股", "pe": 24.0},
                                 _val(pct=45.0, pe=24.0, pe_med=22.0))
    acts = _acts(result)
    reason = next(r for a, r in acts if a == "暂缓补仓")
    assert "安全边际" in reason
    assert "只宜小仓位" in reason, f"质量差却没说仓位限制：{reason}"


def test_质量数据缺失时补仓不受影响(fake_caches):
    """ETF 等无护城河数据的标的，不能因为缺数据就拦着不让补"""
    fake_caches({}, {})
    result = pa.analyze_position(_pos(), {"price": 8.0, "name": "测试股", "pe": 12.0}, _val(pct=25.0))
    acts = _acts(result)
    assert any(a == "补仓" for a, _ in acts)
    assert result["quality"] is None
