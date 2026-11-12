# ============================================================
# test_valuation_sample_coverage.py — 分位/中位数必须有足够样本支撑
# ------------------------------------------------------------
# 事故：长鑫科技 688825 上市仅 3.5 个月（73 个数据点），旧实现里
#   recent_window(pe, 10) 在只有 3 个月数据时返回的是全部数据，
#   于是 1y/3y/5y/10y 四个窗口拿到同一批点 → 四个分位全部 = 7.6%，
#   界面上显示成「10年分位 6%，处于历史低位」，而实际只是三个月内的位置。
#   更糟的是 pe_median_5y 用这 73 个泡沫期点算出 46.36 倍，
#   反推的「合理估值」比现价高一倍，直接变成买入信号。
#
# 修复原则（假数字比没数字危险）：
#   · 窗口覆盖 < 80%  → 该窗口分位返回 None，下游显示「数据缺失」
#   · 覆盖 < 4 年     → 不给「5 年中位数」
#   · 上市 < 1 年     → 全历史兜底也不当估值锚（下游走「样本不足」分支）
#   · 合理估值被钳制  → basis 里留痕，不静默
# ============================================================

import os
import sys

import pytest

pd = pytest.importorskip("pandas")
# 不需要 akshare：这里测的是 _pct_result 纯计算逻辑，
# valuation_data 已把 akshare 改成可选依赖

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

import valuation_data as vd


def _series(years: float, pe_value=20.0):
    """构造一段连续交易日序列，日历跨度恰为 years 年。

    必须按日历天数生成：若用「250 个交易日/年 × years」生成，
    7 年只会得到 6.7 年日历跨度（工作日占 5/7），会把覆盖度断言测歪。
    """
    end = pd.Timestamp("2026-11-10")
    start = end - pd.Timedelta(days=int(years * 365.25))
    dates = pd.date_range(start=start, end=end, freq="B")
    n = len(dates)
    vals = [15.0 + (pe_value - 15.0) * i / max(n - 1, 1) for i in range(n)]
    return dates, vals


# ── 分位窗口的覆盖度检查 ──────────────────────────────

def test_上市三个月_所有窗口分位都返回None():
    """长鑫场景：3.5 个月数据，四个窗口一个都不能给数字"""
    dates, vals = _series(0.3, pe_value=20.52)
    r = vd._pct_result("888001", dates, vals, vals, 41.0)
    for label in ("1y", "3y", "5y", "10y"):
        assert r[f"pe_pct_{label}"] is None, f"{label} 窗口只有 0.3 年样本却给了 {r[f'pe_pct_{label}']}"
    assert r["history_years"] < 0.4
    # 全历史分位仍保留，但必须配 history_years 一起读
    assert r["pe_pct_all"] is not None


def test_不足四年_不给五年中位数():
    """中位数窗口同样要覆盖：3 年的数据不能叫「5 年中位数」"""
    dates, vals = _series(3.0)
    r = vd._pct_result("888001", dates, vals, vals, 30.0)
    assert r["pe_median_5y"] is None, "3 年样本不该产出 5 年中位数"
    assert r["pe_pct_3y"] is not None, "3 年窗口本身是够的"


def test_七年样本_十年分位为None五年有效():
    """阿里场景：6.96 年数据 → 10y 窗口覆盖不足（<8年）返回 None，5y 有效"""
    dates, vals = _series(7.0)
    r = vd._pct_result("888001", dates, vals, vals, 100.0)
    assert r["pe_pct_10y"] is None, "7 年样本不该产出 10 年分位"
    assert r["pe_pct_5y"] is not None
    assert r["pe_median_5y"] is not None, "7 年足够算 5 年中位数"
    assert 6.8 < r["history_years"] < 7.2


def test_九年样本_十年分位有效():
    """覆盖 80% 即放行：9 年 ≥ 10×0.8 = 8 年"""
    dates, vals = _series(9.0)
    r = vd._pct_result("888001", dates, vals, vals, 50.0)
    assert r["pe_pct_10y"] is not None


def test_样本元信息齐全():
    dates, vals = _series(2.0)
    r = vd._pct_result("888001", dates, vals, vals, 20.0)
    assert r["history_start"] and r["history_points"] > 0
    assert isinstance(r["history_years"], float)


# ── 合理估值钳制留痕 ──────────────────────────────────

def test_合理估值被钳制时标注():
    """长鑫场景：PB 中位数/当前 PB = 2.4 倍，被钳到 2.0，必须留痕"""
    import portfolio_advice as pa
    val = {"pb": 10.0, "pb_median_5y": 24.0, "pe_ttm": None, "pe_median_5y": None}
    fv, basis = pa.estimate_fair_value(val, 40.0, None)
    assert fv == pytest.approx(80.0), f"应被钳到 2 倍：{fv}"
    assert "边界值" in basis or "可信范围" in basis, f"钳制没留痕：{basis}"


def test_合理估值未钳制时不加标注():
    import portfolio_advice as pa
    val = {"pb": 10.0, "pb_median_5y": 8.0, "pe_ttm": None, "pe_median_5y": None}
    fv, basis = pa.estimate_fair_value(val, 40.0, None)
    assert fv == pytest.approx(32.0)
    assert "边界值" not in basis


def test_中位数缺失时不给合理估值():
    """样本不足导致中位数为 None 时，必须放弃合理估值而不是拿别的凑"""
    import portfolio_advice as pa
    val = {"pb": 10.0, "pb_median_5y": None, "pe_ttm": 20.0, "pe_median_5y": None}
    fv, basis = pa.estimate_fair_value(val, 40.0, 20.0)
    assert fv is None and basis is None
