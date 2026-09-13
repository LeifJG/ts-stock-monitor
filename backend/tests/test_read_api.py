# ============================================================
# backend/tests/test_read_api.py — 阶段①只读镜像接口单测
# ============================================================
# 跑法：cd backend && .venv/bin/python3 -m pytest tests/ -v
# 思路（对前端）：≈ vitest，用 FastAPI 官方 TestClient 直接打路由，
# 不用真的起服务；pytest fixture ≈ vitest 的 beforeEach。

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# 测试数据路径：用主项目 data/ 目录的真实缓存（只读，不动）
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


def _load(name: str):
    return json.loads((DATA_DIR / name).read_text())


# ── health ──────────────────────────────────────────────────
def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["data_dir_exists"] is True


# ── moat：合并叙述层 + 数值 normalize ────────────────────────
def test_moat_merge_narrative_and_normalize():
    moat = _load("moat_cache.json")
    llm = _load("moat_llm_cache.json")
    llm_codes = [c for c in llm if c in moat]
    assert llm_codes, "moat_llm_cache 里应有已生成的叙述"

    r = client.get(f"/api/v1/moat?codes={llm_codes[0]},600519")
    assert r.status_code == 200
    data = r.json()["data"]
    # narrative 来自 llm 缓存，有就合入
    if llm.get(llm_codes[0]):
        assert data[llm_codes[0]]["narrative"] == llm[llm_codes[0]]
    # 不在请求里的 code 不出现
    assert set(data.keys()) <= {"600519", llm_codes[0]}


def test_moat_unknown_code_skipped():
    r = client.get("/api/v1/moat?codes=999999")
    assert r.status_code == 200
    assert r.json()["data"] == {}


# ── shareholders：单数 code + 404 语义 ───────────────────────
def test_shareholders_ok():
    data = _load("shareholder_cache.json")
    some_code = next(iter(data))
    r = client.get(f"/api/v1/shareholders?code={some_code}")
    assert r.status_code == 200
    assert r.json()["data"]["code"] == some_code


def test_shareholders_404():
    r = client.get("/api/v1/shareholders?code=999999")
    assert r.status_code == 404


def test_shareholders_missing_param():
    r = client.get("/api/v1/shareholders")
    assert r.status_code == 422  # FastAPI 必填参数缺失默认 422


# ── valuation：数组输出保持传入顺序 ──────────────────────────
def test_valuation_ordered_list():
    data = _load("valuation_cache.json")
    codes = [c for c in data.keys()][:2]
    r = client.get(f"/api/v1/valuation?codes={codes[1]},{codes[0]}")
    body = r.json()["data"]
    assert [row["code"] for row in body] == [codes[1], codes[0]]


def test_valuation_missing_param():
    r = client.get("/api/v1/valuation")
    assert r.status_code == 422


# ── dividend-yields：未知 code 给 null 而不是报错 ────────────
def test_dividend_yields_unknown_gives_null():
    r = client.get("/api/v1/dividend-yields?codes=600519,999999")
    data = r.json()["data"]
    assert data["999999"] is None
    assert "600519" in data


# ── volatility：顶层字段与旧接口同形 ─────────────────────────
def test_volatility_shape():
    cache = _load("volatility_cache.json")
    r = client.get("/api/v1/volatility")
    body = r.json()
    assert body["success"] is True
    assert body["generatedAt"] == cache["generated_at"]
    assert body["ok"] == cache["ok"]
    assert body["total"] == cache["total"]
    assert body["data"].keys() == cache["items"].keys()


# ── fx：字段改名 + stale 判定 ────────────────────────────────
def test_fx_response_shape():
    r = client.get("/api/v1/fx")
    body = r.json()
    assert set(body.keys()) == {"success", "rate", "source", "date", "updatedAt", "stale"}
    assert body["success"] is True


# ── insider：阶段①明确 425 ──────────────────────────────────
def test_insider_phase1_not_impl():
    r = client.get("/api/v1/insider?codes=600519")
    assert r.status_code == 425
