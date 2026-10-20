# ============================================================
# backend/tests/test_cache_store.py — 阶段②缓存表化单测
# ============================================================
# 跑法：cd backend && .venv/bin/python3 -m pytest tests/ -v
# 覆盖：读写往返、TTL 过期语义、json→PG 导入对账、文件变更自愈

import json
import time
from pathlib import Path

import pytest

from app.services import cache_store

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


# ── 基础读写往返 ────────────────────────────────────────────
def test_set_and_get_one():
    cache_store.set_one("_test_ns", "TEST01", {"a": 1, "b": "中文"}, ttl_hours=1)
    got = cache_store.get_one("_test_ns", "TEST01")
    assert got == {"a": 1, "b": "中文"}


def test_get_one_missing_returns_none():
    assert cache_store.get_one("_test_ns", "NOT_EXIST_XYZ") is None


def test_set_many_and_get_many():
    items = {"A1": {"v": 0.5}, "A2": {"v": 1}}
    n = cache_store.set_many("_test_bulk", items, ttl_hours=1)
    assert n == 2
    got = cache_store.get_many("_test_bulk")
    assert got == items
    # 按 codes 过滤
    assert set(cache_store.get_many("_test_bulk", ["A1"]).keys()) == {"A1"}


# ── TTL 语义：负 TTL 立即过期 ───────────────────────────────
def test_expired_row_hidden():
    cache_store.set_one("_test_ttl", "X1", {"v": 1}, ttl_hours=-1)  # 已过期
    assert cache_store.get_one("_test_ttl", "X1") is None
    assert cache_store.get_many("_test_ttl") == {}


# ── 覆盖写（幂等）───────────────────────────────────────────
def test_upsert_overwrites():
    cache_store.set_one("_test_ns", "TEST01", {"a": 999}, ttl_hours=1)
    assert cache_store.get_one("_test_ns", "TEST01") == {"a": 999}


# ── 真实 json 导入 + 对账 ───────────────────────────────────
@pytest.mark.parametrize("ns", ["moat", "volatility"])
def test_import_and_verify(ns):
    res = cache_store.import_namespace(ns)
    assert res["rows"] > 0
    v = cache_store.verify_namespace(ns)
    assert v["ok"], f"{ns} 对账失败: {v}"


def test_volatility_meta_imported():
    cache_store.import_namespace("volatility")
    meta = cache_store.get_meta("volatility")
    src = json.loads((DATA_DIR / "volatility_cache.json").read_text())
    assert meta.get("total") == src["total"]
    assert meta.get("ok") == src["ok"]


# ── 文件变更自愈：json 比库新 → 自动重新导入 ─────────────────
def test_maybe_refresh_detects_newer_file():
    cache_store.import_namespace("moat")
    # 首次：文件不比库新（刚导入过），不应触发
    assert cache_store.maybe_refresh("moat") is False
    # 模拟文件被刷新脚本更新：把库内 updated_at 调到过去
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import update
    from app.db import session_scope
    from app.models import Cache

    with session_scope() as s:
        s.execute(
            update(Cache)
            .where(Cache.namespace == "moat")
            .values(updated_at=datetime.now(timezone.utc) - timedelta(days=30))
        )
    assert cache_store.maybe_refresh("moat") is True
