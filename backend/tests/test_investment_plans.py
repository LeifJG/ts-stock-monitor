# ============================================================
# test_investment_plans.py — 定投计划引擎
# ------------------------------------------------------------
# 三条硬规则各锁一组：
#   ① 均线偏离决定倍数（越跌越多买）
#   ② 溢价超标就不买（场内 QDII 溢价 16% 时买入 = 立刻亏 16%）
#   ③ 数据缺失不猜（均线取不到时宁可 skip，也不能默认按常规投）
#
# 取数全部 monkeypatch 掉，测试不依赖网络。
# ============================================================

import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

import investment_plans as ip


# ── ① 均线档位 ─────────────────────────────────────────

@pytest.mark.parametrize("dev,expect", [
    (-15.0, 2.0), (-10.0, 2.0), (-7.0, 1.5), (-5.0, 1.5),
    # 边界：档位是「deviation ≤ deviationLte」闭区间，所以 5.0 仍属常规档，
    # 5.1 才进入「高于均线 5% 以上，减半」档
    (-4.9, 1.0), (0.0, 1.0), (4.9, 1.0), (5.0, 1.0), (5.1, 0.5), (20.0, 0.5),
])
def test_均线偏离选档(dev, expect):
    mult, _ = ip.pick_multiplier(dev, ip.DEFAULT_TIERS)
    assert mult == expect, f"偏离 {dev}% 应为 {expect} 份，实际 {mult}"


# ── ② 定投日判断 ───────────────────────────────────────

def test_月度定投日_命中():
    due, _ = ip.is_due_today({"frequency": "monthly", "dayOfMonth": 15}, date(2026, 11, 15))
    assert due


def test_月度定投日_未命中():
    due, _ = ip.is_due_today({"frequency": "monthly", "dayOfMonth": 15}, date(2026, 11, 16))
    assert not due


def test_设31号时月末兜底():
    """11 月只有 30 天，设 31 号应在 30 号触发，而不是永远不触发"""
    due_30, _ = ip.is_due_today({"frequency": "monthly", "dayOfMonth": 31}, date(2026, 11, 30))
    assert due_30, "11 月 30 日应被 31 号计划命中"


def test_每周定投日():
    plan = {"frequency": "weekly", "dayOfWeek": 0}   # 周一
    assert ip.is_due_today(plan, date(2026, 11, 23))[0]      # 2026-11-23 是周一
    assert not ip.is_due_today(plan, date(2026, 11, 24))[0]  # 周二


def test_双周定投_按起算日判断单双周():
    plan = {"frequency": "biweekly", "dayOfWeek": 0, "startDate": "2026-11-09"}  # 周一
    assert ip.is_due_today(plan, date(2026, 11, 9))[0]      # 第 0 周
    assert not ip.is_due_today(plan, date(2026, 11, 16))[0]  # 第 1 周
    assert ip.is_due_today(plan, date(2026, 11, 23))[0]      # 第 2 周


# ── ③ 溢价过滤与数据缺失 ────────────────────────────────

def _plan(**kw):
    base = {
        "id": "ndx", "name": "纳指测试", "mode": "onsite", "target": "513100",
        "proxyIndex": ".NDX", "baseAmount": 3000, "frequency": "monthly", "dayOfMonth": 15,
        "strategy": {"maWindow": 250, "premiumMax": 2.0, "tiers": ip.DEFAULT_TIERS,
                     "goldenDrop": {"monthlyDrop": 15, "extraMultiplier": 1.0}},
    }
    base.update(kw)
    return base


def _rows(close_now=100.0, close_30d=100.0, n=300):
    """构造日线：最后一天 close_now，30 天前 close_30d，其余按线性插值（保证 MA 可算）"""
    from datetime import timedelta
    end = date(2026, 11, 15)
    rows = []
    for i in range(n):
        d = end - timedelta(days=n - 1 - i)
        if i == n - 1:
            c = close_now
        elif i == n - 31:
            c = close_30d
        else:
            c = 100.0
        rows.append({"date": d.isoformat(), "close": c})
    return rows


def test_溢价超标则不买(monkeypatch):
    """核心风控：QDII 溢价 16% 时买入等于立刻亏 16%"""
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: _rows())
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "纳指ETF", "price": 2.079,
                                      "prevClose": 2.13, "nav": 1.788, "premiumPct": 16.28,
                                      "asOf": "2026-11-15"})
    r = ip.evaluate_plan(_plan(), today=date(2026, 11, 15))
    assert r["isDueToday"] is True
    assert r["action"] == "skip", f"溢价 16% 却给出 {r['action']}"
    assert "溢价" in r["headline"]
    assert r["amount"] == 0


def test_溢价正常则按倍数买(monkeypatch):
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: _rows(close_now=90.0))
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "纳指ETF", "price": 1.80,
                                      "prevClose": 1.79, "nav": 1.79, "premiumPct": 0.56,
                                      "asOf": "2026-11-15"})
    r = ip.evaluate_plan(_plan(), today=date(2026, 11, 15))
    assert r["action"] == "buy"
    # 现价 90 低于 MA（100 附近）→ 至少 1.5 份
    assert r["multiplier"] >= 1.5
    assert r["amount"] == round(3000 * r["multiplier"])


def test_均线数据缺失时不买(monkeypatch):
    """取不到指数日线就 skip —— 不知道贵贱时按常规投是赌博"""
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: None)
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "x", "price": 1, "prevClose": 1,
                                      "nav": 1, "premiumPct": 0.5, "asOf": ""})
    r = ip.evaluate_plan(_plan(), today=date(2026, 11, 15))
    assert r["action"] == "skip"
    assert any("均线" in x for x in r["reasons"]) or "均线" in r["headline"]


def test_场外计划不查溢价(monkeypatch):
    """场外按净值申购，没有溢价问题（但有申购限额，属于人工确认项）"""
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: _rows(close_now=90.0))
    called = {"n": 0}
    def fake_quote(code):
        called["n"] += 1
        return None
    monkeypatch.setattr(ip, "fetch_etf_quote", fake_quote)
    r = ip.evaluate_plan(_plan(mode="otc", target="161130"), today=date(2026, 11, 15))
    assert called["n"] == 0, "场外计划不该去查场内溢价"
    assert r["premiumPct"] is None
    assert r["action"] == "buy"


def test_非定投日只提示不买(monkeypatch):
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: _rows())
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "x", "price": 1, "prevClose": 1,
                                      "nav": 1, "premiumPct": 0.5, "asOf": ""})
    r = ip.evaluate_plan(_plan(dayOfMonth=15), today=date(2026, 11, 20))
    assert r["action"] == "wait"
    assert r["amount"] == 0


def test_月跌幅达标触发金字塔加码(monkeypatch):
    """近 30 日跌 20%（阈值 15%）→ 额外加 1 份"""
    monkeypatch.setattr(ip, "fetch_index_daily",
                        lambda *a, **k: _rows(close_now=80.0, close_30d=100.0))
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "x", "price": 1, "prevClose": 1,
                                      "nav": 1, "premiumPct": 0.5, "asOf": ""})
    r = ip.evaluate_plan(_plan(), today=date(2026, 11, 15))
    assert r["monthDropPct"] <= -15
    # 偏离 + 加码 = 至少 2 份（偏离档 2.0 + 加码 1.0）
    assert r["multiplier"] >= 2.0


# ── ④ 下次定投日（日报要显示「下次哪天投」）──────────────

def test_下次定投日_本月未到():
    """15 号计划，今天 5 号 → 下次是本月 15 号"""
    d = ip.next_due_date({"frequency": "monthly", "dayOfMonth": 15}, date(2026, 11, 5))
    assert d == date(2026, 11, 15)


def test_下次定投日_本月已过则跳下月():
    d = ip.next_due_date({"frequency": "monthly", "dayOfMonth": 15}, date(2026, 11, 20))
    assert d == date(2026, 12, 15)


def test_下次定投日_当天算下次():
    """定投日当天，下次定投日就是今天（用户要知道今天该动手）"""
    d = ip.next_due_date({"frequency": "monthly", "dayOfMonth": 15}, date(2026, 11, 15))
    assert d == date(2026, 11, 15)


def test_下次定投日_设31号时的月末兜底():
    """设 31 号但 11 月只有 30 天 → 下次是 11-30，不是跳到 12-31"""
    d = ip.next_due_date({"frequency": "monthly", "dayOfMonth": 31}, date(2026, 11, 5))
    assert d == date(2026, 11, 30)


def test_下次定投日_跨年():
    """12 月过完 → 次年 1 月"""
    d = ip.next_due_date({"frequency": "monthly", "dayOfMonth": 10}, date(2026, 12, 20))
    assert d == date(2027, 1, 10)


def test_下次定投日_每周():
    d = ip.next_due_date({"frequency": "weekly", "dayOfWeek": 0}, date(2026, 11, 25))
    assert d.weekday() == 0 and d >= date(2026, 11, 25)


def test_下次定投日_双周按起算日():
    plan = {"frequency": "biweekly", "dayOfWeek": 0, "startDate": "2026-11-09"}
    d = ip.next_due_date(plan, date(2026, 11, 10))
    # 11-09 是起算周（第 0 周），下一周 11-16 属第 1 周不投，再下周 11-23 是第 2 周
    assert d == date(2026, 11, 23), f"实际 {d}"


def test_evaluate_plan_带出下次定投日(monkeypatch):
    monkeypatch.setattr(ip, "fetch_index_daily", lambda *a, **k: _rows())
    monkeypatch.setattr(ip, "fetch_etf_quote",
                        lambda code: {"code": code, "name": "x", "price": 1, "prevClose": 1,
                                      "nav": 1, "premiumPct": 0.5, "asOf": ""})
    r = ip.evaluate_plan(_plan(dayOfMonth=15), today=date(2026, 11, 20))
    assert r["nextDueDate"] == "2026-12-15"
