# ============================================================
# backend/tests/test_portfolio_store.py — 持仓读写服务单测
# ============================================================
# ⚠ 这些测试一律用临时目录里造的文件，绝不碰 data/portfolio.json。
#   做法：monkeypatch 掉 store 模块的 PORTFOLIO_FILE / BACKUP_DIR。
#
# 锁定的行为（都是与 TS 对拍时真实踩出来的差异）：
#   1. 整值 float 写文件要变成 int（20.0 → 20），否则字节对不上
#   2. dividends: [] 要照样写出（JS 里空数组是 truthy），不能当"假"省略
#   3. 坏数据（0 股 / 无代码 / 无成本）必须在写盘前过滤
#   4. 写盘是原子的（临时文件 + replace），失败不留半截文件

import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from app.services import portfolio_store as store


@pytest.fixture()
def tmp_store(tmp_path, monkeypatch):
    """把读写路径重定向到临时目录"""
    pf = tmp_path / "portfolio.json"
    bd = tmp_path / "backup"
    monkeypatch.setattr(store, "PORTFOLIO_FILE", pf)
    monkeypatch.setattr(store, "BACKUP_DIR", bd)
    # PG 镜像在单测里不参与，直接屏蔽
    monkeypatch.setattr(store, "_mirror_to_pg", lambda positions: None)
    pf.write_text("[]", encoding="utf-8")
    return pf


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── 读 ────────────────────────────────────────────────────
def test_read_missing_file_returns_empty(tmp_store):
    tmp_store.unlink()
    assert store.read_portfolio() == []


def test_read_broken_json_returns_empty(tmp_store):
    tmp_store.write_text("{ 不是合法 json", encoding="utf-8")
    assert store.read_portfolio() == []


def test_read_normal(tmp_store):
    write_json(tmp_store, [{"code": "888001", "shares": 100, "cost": 10}])
    data = store.read_portfolio()
    assert len(data) == 1
    assert data[0]["code"] == "888001"


# ── 数字归一（字节级对齐 JS）─────────────────────────────
def test_normalize_numbers_integral_float_to_int():
    assert store.normalize_numbers(20.0) == 20
    assert isinstance(store.normalize_numbers(20.0), int)
    assert store.normalize_numbers(85.29) == 85.29
    assert store.normalize_numbers(True) is True          # bool 不能被当数字处理
    assert store.normalize_numbers({"a": [1.0, 2.5]}) == {"a": [1, 2.5]}


def test_write_integral_cost_as_int(tmp_store):
    """cost 20.0 必须写成 20，和 JS JSON.stringify 一致"""
    store.write_portfolio([{"code": "888001", "shares": 200, "cost": 20.0}])
    raw = tmp_store.read_text(encoding="utf-8")
    assert '"cost": 20' in raw
    assert "20.0" not in raw


# ── 同步逻辑 ───────────────────────────────────────────────
def test_sync_filters_bad_records(tmp_store):
    res = store.sync_positions([
        {"code": "888001", "shares": 100, "cost": 10},
        {"code": "888002", "shares": 0, "cost": 10},      # 0 股
        {"code": "", "shares": 100, "cost": 10},          # 无代码
        {"code": "888003", "shares": 100, "cost": 0},     # 无成本
    ])
    assert res["count"] == 1
    assert res["message"] == "同步成功：1 条持仓"


def test_sync_field_priority_costprice_first(tmp_store):
    store.sync_positions([{"code": "888001", "shares": 100, "costPrice": 12.5, "cost": 99.9, "buyPrice": 88.8}])
    assert store.read_portfolio()[0]["cost"] == 12.5


def test_sync_falls_back_to_cost_then_buyprice(tmp_store):
    store.sync_positions([{"code": "888001", "shares": 100, "cost": 45.6, "buyPrice": 88.8}])
    assert store.read_portfolio()[0]["cost"] == 45.6
    store.sync_positions([{"code": "888002", "shares": 100, "buyPrice": 88.8}])
    assert store.read_portfolio()[0]["cost"] == 88.8


def test_sync_empty_dividends_kept(tmp_store):
    """空数组要写出（JS 里 [] 是 truthy），不能被省略"""
    store.sync_positions([{"code": "888001", "shares": 100, "cost": 10, "dividends": []}])
    pos = store.read_portfolio()[0]
    assert "dividends" in pos and pos["dividends"] == []


def test_sync_dividends_inherited_when_absent(tmp_store):
    """payload 没带 dividends 字段 → 继承服务端已有"""
    write_json(tmp_store, [{
        "code": "888001", "shares": 100, "cost": 10,
        "dividends": [{"id": "d1", "date": "2026-07-01", "perShare": 1, "total": 100}],
    }])
    store.sync_positions([{"code": "888001", "shares": 200, "cost": 10}])
    pos = store.read_portfolio()[0]
    assert len(pos["dividends"]) == 1
    assert pos["dividends"][0]["total"] == 100


def test_sync_dividends_cleared_when_empty_array(tmp_store):
    """payload 显式给 [] → 清空，不继承"""
    write_json(tmp_store, [{
        "code": "888001", "shares": 100, "cost": 10,
        "dividends": [{"id": "d1", "date": "2026-07-01", "perShare": 1, "total": 100}],
    }])
    store.sync_positions([{"code": "888001", "shares": 200, "cost": 10, "dividends": []}])
    assert store.read_portfolio()[0]["dividends"] == []


def test_sync_baseshares_passthrough(tmp_store):
    store.sync_positions([{"code": "888001", "shares": 800, "cost": 12.5,
                           "baseShares": 600, "lastAddPrice": 11.0}])
    pos = store.read_portfolio()[0]
    assert pos["baseShares"] == 600
    assert pos["lastAddPrice"] == 11


def test_sync_baseshares_omitted_when_equal(tmp_store):
    """baseShares 等于当前股数时不写该字段（视为未补仓）"""
    store.sync_positions([{"code": "888001", "shares": 500, "cost": 10, "baseShares": 500}])
    assert "baseShares" not in store.read_portfolio()[0]


def test_sync_lastaddprice_inherited(tmp_store):
    write_json(tmp_store, [{"code": "888001", "shares": 100, "cost": 10, "lastAddPrice": 9.5}])
    store.sync_positions([{"code": "888001", "shares": 200, "cost": 10}])
    assert store.read_portfolio()[0]["lastAddPrice"] == 9.5


def test_sync_rejects_non_array():
    with pytest.raises(ValueError):
        store.sync_positions({"not": "a list"})


# ── 写盘安全 ───────────────────────────────────────────────
def test_write_creates_backup_before_overwrite(tmp_store):
    write_json(tmp_store, [{"code": "888001", "shares": 100, "cost": 10}])
    store.write_portfolio([{"code": "888002", "shares": 50, "cost": 5}])
    backups = list((tmp_store.parent / "backup").glob("portfolio.json.*.bak"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text(encoding="utf-8"))[0]["code"] == "888001"


def test_write_is_atomic_leaves_no_temp_files(tmp_store):
    store.write_portfolio([{"code": "888001", "shares": 100, "cost": 10}])
    leftovers = [p.name for p in tmp_store.parent.iterdir() if p.name.startswith(".portfolio.")]
    assert leftovers == []


def test_write_same_day_only_one_backup(tmp_store):
    write_json(tmp_store, [{"code": "888001", "shares": 100, "cost": 10}])
    store.write_portfolio([{"code": "888002", "shares": 1, "cost": 1}])
    store.write_portfolio([{"code": "888003", "shares": 1, "cost": 1}])
    assert len(list((tmp_store.parent / "backup").glob("*.bak"))) == 1
