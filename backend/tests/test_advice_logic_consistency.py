# ============================================================
# test_advice_logic_consistency.py — 建议逻辑的自洽性契约
# ------------------------------------------------------------
# 这些用例全部来自「穷举边界组合」审计时发现的真实矛盾，不是凭空设想：
#
# 矛盾1 质量差反而减得少
#   R1.5（质量闸门，减 15%）抢在 R2（部分止盈，减 25%）前面命中，
#   导致质量不合格的票在「浮盈 20% + 超合理估值」时只减 150 股，
#   而质量好的同类减 250 股 —— 方向完全反了。
#
# 矛盾2 同一分位两边各说各话
#   分位 50~70 时补仓侧说「估值中性·质量不合格」，
#   卖出侧 R3 同时说「部分止盈」—— 一只票一边说中性一边让你卖。
#
# 矛盾3 新股假分位换条路径复活
#   「上市不足 1 年」的闸门原来只挡「全历史兜底」那一支，
#   若数据源直接给了 5y 分位就绕过去了。
#
# 矛盾4 溢价 4.9% 时一侧说「高于」一侧说「未高于」
#   补仓侧 >0 就算高于，卖出侧要 ≥5%（缓冲线）才算，同一只票两句打架。
# ============================================================

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

import portfolio_advice as pa


def _quality(grade):
    if grade is None:
        return lambda code: None
    return lambda code: {
        "grade": grade, "rating": "none", "ratingLabel": "无护城河", "score": 30,
        "roic": 5.0, "yearsAboveWacc": 1, "shareholderYield": 1.0, "gmTrend": -15.0,
        "warnings": ["ROIC 近 5 年只有 1 年跑赢资金成本", "股东总回报仅 1.00%，非收息资产"],
    }


def _run(monkeypatch, pct, grade, pnl, premium_pct, history_years=8.0):
    """构造一只持仓并跑完整建议。premium_pct 正数 = 现价高于合理估值"""
    monkeypatch.setattr(pa, "evaluate_quality", _quality(grade))
    pos = {"stockCode": "888001", "stockName": "测试股", "shares": 1000,
           "cost": 10.0 / (1 + pnl / 100)}
    quote = {"price": 10.0, "name": "测试股", "pe": 12.0}
    val = {"pe_ttm": 12.0, "pe_median_5y": 12.0 / (1 + premium_pct / 100),
           "pb": 2.0, "pb_median_5y": 2.0,
           "pe_pct_5y": pct, "pe_pct_10y": pct,
           "pb_pct_5y": pct, "pb_pct_10y": pct,
           "history_years": history_years}
    r = pa.analyze_position(pos, quote, val)
    return [(o["action"], o["reason"]) for o in r["adviceSummary"]["costAdvice"]]


def _sell_shares(acts):
    for a, _ in acts:
        if a.startswith("卖 "):
            return int(a.split()[1])
    return 0


def _is_sell(act):
    return act.startswith("卖") or (("止盈" in act or "减仓" in act) and "不减仓" not in act)


# ── 矛盾1：质量差不该减得更少 ──────────────────────────

def test_质量差浮盈高时交给R2减25pct(monkeypatch):
    """分位 70 + 浮盈 20% + 超合理估值：R2 该减 250 股，不能被 R1.5 抢去只减 150"""
    poor = _run(monkeypatch, 70.0, "poor", 20, 10)
    good = _run(monkeypatch, 70.0, "good", 20, 10)
    assert _sell_shares(poor) == _sell_shares(good) == 250, \
        f"质量差的减仓量 {_sell_shares(poor)} 不该少于质量好的 {_sell_shares(good)}"


def test_质量差浮亏时R15接管减仓(monkeypatch):
    """分位 70 + 浮亏：原规则不会动手，R1.5 兜住 → 减 150"""
    acts = _run(monkeypatch, 70.0, "poor", -20, -20)
    assert any(a == "质量估值双弱·减仓" for a, _ in acts)
    assert _sell_shares(acts) == 150


def test_质量好的同类票浮亏不减仓(monkeypatch):
    """对照组：质量好 + 浮亏 + 分位 70 → 不该因为质量闸门而减仓（质量好不被误伤）"""
    acts = _run(monkeypatch, 70.0, "good", -20, -20)
    assert not any(_is_sell(a) for a, _ in acts)


# ── 矛盾2：同一分位不能两边各说各话 ────────────────────

def test_中性分位高浮盈只有卖出建议不再说估值中性(monkeypatch):
    """分位 60 + 浮盈 20% + 超合理估值：卖出侧会部分止盈，就不能再说「估值中性」"""
    acts = _run(monkeypatch, 60.0, "poor", 20, 10)
    labels = [a for a, _ in acts]
    assert any("部分止盈" in a for a in labels)
    assert not any("估值中性" in a for a in labels), f"估值中性 与 部分止盈 冲突：{labels}"


def test_中性分位无卖出动作时补质量提示(monkeypatch):
    """分位 60 + 小浮盈 + 质量差：卖出侧无动作，才补「估值中性·质量不合格」"""
    acts = _run(monkeypatch, 60.0, "poor", 2, 10)
    labels = [a for a, _ in acts]
    assert labels == ["估值中性·质量不合格"], f"应只给一条中性提示：{labels}"


def test_中性分位质量好时保持沉默(monkeypatch):
    acts = _run(monkeypatch, 60.0, "good", 2, 10)
    assert acts == [], "质量好且估值中性时不该制造噪音"


# ── 矛盾3：新股防护要覆盖所有分位来源 ──────────────────

def test_新股样本不足时任何分位都作废(monkeypatch):
    """样本 0.5 年即便分位字段有值，也必须判为估值数据缺失"""
    for premium in (-20, 10):
        acts = _run(monkeypatch, 20.0, "poor", 0, premium, history_years=0.5)
        labels = [a for a, _ in acts]
        assert labels == ["估值数据缺失·按纪律判断"], \
            f"新股分位没作废（溢价 {premium}%）：{labels}"
        assert not any("补" in a for a in labels)


# ── 矛盾4：溢价口径两侧一致 ────────────────────────────

def test_溢价不足缓冲线时两侧口径一致(monkeypatch):
    """溢价 4%：补仓侧说「高于 4%」，卖出侧不能反口说「未高于」"""
    acts = _run(monkeypatch, 30.0, "good", 20, 4)
    reasons = " ".join(r for _, r in acts)
    assert "未高于合理估值" not in reasons, f"溢价 4% 却说未高于：{reasons}"
    assert "缓冲线" in reasons or "高于合理估值" in reasons


def test_分位低于50绝不卖出(monkeypatch):
    """分位 <50 是最硬的一条：任何浮盈/质量组合都不能产生真实卖出动作"""
    for pct in (None, 10, 45, 49.99):
        for pnl in (-30, 0, 20, 50):
            for grade in (None, "poor", "good"):
                for premium in (8, -20):
                    if pct is None and grade is not None:
                        continue
                    acts = _run(monkeypatch, pct, grade, pnl, premium)
                    assert not any(_is_sell(a) for a, _ in acts), \
                        f"分位 {pct} 却出现卖出：{[a for a, _ in acts]}"
