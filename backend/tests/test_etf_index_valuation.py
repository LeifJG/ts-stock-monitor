# ============================================================
# test_etf_index_valuation.py — ETF 用标的指数分位兜底 + 深证指数补数据源
# ------------------------------------------------------------
# 背景：ETF 没有个股 PE，估值分位永远缺失 → 面板只能写"估值数据缺失"。
# 588080（科创50ETF）应该取 000688 的 5 年分位（63%）。
# 同时创业板指（399006）中证接口没有，改用乐咕 TTM PE 序列。
# ============================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts"))

import portfolio_advice as pa
from etf_index_map import ETF_INDEX_MAP, etf_underlying_index, is_etf_code
from fetch_index_valuations import LEGULUGU_CODES


def test_腾讯行情符号_ETF在沪市():
    """588080（科创50ETF）是沪市；拼成 sz588080 就拿不到行情，会静默用成本价"""
    from portfolio_advice import to_tencent_symbol
    assert to_tencent_symbol("588080") == "sh588080"
    assert to_tencent_symbol("510300") == "sh510300"
    assert to_tencent_symbol("159915") == "sz159915"
    assert to_tencent_symbol("600036") == "sh600036"
    assert to_tencent_symbol("000333") == "sz000333"
    assert to_tencent_symbol("00700") == "hk00700"


def test_etf_识别():
    assert is_etf_code("588080")
    assert is_etf_code("510300")
    assert is_etf_code("159915")
    assert not is_etf_code("600036")
    assert not is_etf_code("000333")


def test_科创50ETF映射到000688():
    mapped = etf_underlying_index("588080")
    assert mapped is not None
    assert mapped[0] == "000688"


def test_同一指数多家ETF都要登记():
    # 科创50 有 588000 / 588080 / 588090，只登记一个会漏
    for code in ("588000", "588080", "588090"):
        mapped = etf_underlying_index(code)
        assert mapped is not None and mapped[0] == "000688"


def test_未登记ETF返回None():
    assert etf_underlying_index("599999") is None
    assert etf_underlying_index("") is None


def test_深证指数有乐咕代码():
    assert LEGULUGU_CODES.get("399006") == "399006.SZ"


def test_ETF分位取标的指数(monkeypatch):
    """588080 + 指数缓存里有 000688 分位 63% → blend_pct 应该是 63，窗口标注指数"""
    pa._INDEX_VAL_CACHE = {"000688": {"code": "000688", "name": "科创50", "pct_5y": 63.0,
                                      "data_date": "2026-11-03", "pe": 50.52}}
    iv = pa.etf_index_valuation("588080")
    assert iv is not None
    assert iv["pct"] == 63.0
    assert iv["indexName"] == "科创50"

    # 用虚构股数/成本，不写真实持仓（leak_guard 会拦）
    pos = {"stockCode": "588080", "stockName": "科创50ETF", "shares": 10000, "cost": 1.5}
    quote = {"price": 1.2, "name": "科创50ETF"}
    result = pa.analyze_position(pos, quote, None)
    assert result["valuationPct"] == 63.0
    assert "科创50" in (result["valuationWindow"] or "")
    assert "指数" in (result["valuationSource"] or "")


def test_无映射ETF仍走数据缺失(monkeypatch):
    pa._INDEX_VAL_CACHE = {}
    pos = {"stockCode": "599999", "stockName": "某新ETF", "shares": 1000, "cost": 2.0}
    result = pa.analyze_position(pos, {"price": 1.7, "name": "某新ETF"}, None)
    assert result["valuationPct"] is None
    text = str(result)
    assert "估值数据缺失" in text or "没有估值分位" in text
