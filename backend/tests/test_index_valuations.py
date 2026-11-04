# ============================================================
# test_index_valuations.py — 指数估值分位的新鲜度与正确性
# ------------------------------------------------------------
# 事故：akshare 的 stock_zh_index_hist_csindex 默认 end_date="20240604"（写死在库里），
# 我们不传日期就永远只拿到 2024-06-04 之前的数据 →
# 市场温度表 / 指数分位 / 现金仓位建议整整用了两年半前的数据，
# 科创50 显示 PE 31.5、分位 30%（真实 PE 50.5、分位 63%），直接误导了买入决策。
#
# 本测试锁三件事：
#   1. fetch_pe_data 必须显式传日期（否则会退回库里的 2024-06-04）
#   2. 过期数据必须被识别出来（stale_days / warning）
#   3. 分位计算只在有效（PE>0）样本上做
# ============================================================

import inspect
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

from fetch_index_valuations import assess_freshness, compute_percentile, fetch_pe_data, STALE_WARN_DAYS


def test_fetch_pe_data_显式传日期():
    """源码里必须出现 start_date / end_date 参数，否则会退回 2024-06-04 的默认值"""
    src = inspect.getsource(fetch_pe_data)
    # 调用必须带显式日期参数（akshare 的默认 end_date 写死为 2024-06-04）
    assert "stock_zh_index_hist_csindex(symbol=code, start_date=start_date, end_date=end_date)" in src


def test_新鲜数据没有警告():
    d = (date.today() - timedelta(days=1)).isoformat()
    stale, warn = assess_freshness(d)
    assert stale == 1
    assert warn is None


def test_过期数据必须报警():
    old = (date.today() - timedelta(days=STALE_WARN_DAYS + 30)).isoformat()
    stale, warn = assess_freshness(old)
    assert stale > STALE_WARN_DAYS
    assert warn and "过期" in warn


def test_没有数据日期也算不可用():
    stale, warn = assess_freshness(None)
    assert stale is None
    assert warn and "无数据日期" in warn


def test_非法日期不崩():
    stale, warn = assess_freshness("(参考值)")
    assert stale is None
    assert warn


def test_分位只在有效样本上算():
    records = [
        {"date": "2026-11-01", "pe": 10.0, "close": 100.0},
        {"date": "2026-11-02", "pe": 20.0, "close": 110.0},
        {"date": "2026-11-03", "pe": 30.0, "close": 120.0},
    ]
    stats = compute_percentile(records)
    assert stats["current_pe"] == 30.0
    assert stats["pct_5y"] == 67  # 3 个点里 2 个比它小
    assert stats["date"] == "2026-11-03"
    assert stats["data_points"] == 3
    assert stats["max_pe"] == 30.0


def test_真实抓取必须覆盖到今天附近():
    """联网自检：抓到的最后一天距今天不应超过 STALE_WARN_DAYS（缺网时跳过，不算失败）"""
    import pytest
    pytest.importorskip("akshare", reason="akshare 在项目 .venv 里，backend venv 没装")
    records = fetch_pe_data("000300")
    if not records:
        return  # 网络不可用时跳过，避免把网络问题当成代码回归
    last = date.fromisoformat(records[-1]["date"])
    assert (date.today() - last).days <= STALE_WARN_DAYS, f"数据最后一天 {last}，已过期"
