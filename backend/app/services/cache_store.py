# ============================================================
# backend/app/services/cache_store.py — 缓存读写服务层
# ============================================================
# 职责：把「带 TTL 的缓存读写」收口到一处，路由层只管调用。
# 分层思路（前后端通用）：routers 管 HTTP，services 管业务，models 管存储。

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..config import DATA_DIR
from ..db import session_scope
from ..models import Cache, CacheMeta, ImportLog

# 各缓存命名空间 → (源 json 文件, TTL 小时, 是否为整块缓存)
# 整块缓存 = 源文件不是「code → 数据」的字典（例如 volatility 有 items 包裹）
NAMESPACES: dict[str, tuple[str, float | None, bool]] = {
    "moat": ("moat_cache.json", None, False),
    "moat_llm": ("moat_llm_cache.json", 90 * 24, False),
    "fear_tech": ("fear_tech_cache.json", 7 * 24, False),
    "valuation": ("valuation_cache.json", 24, False),
    "dividend_yields": ("dividend_yields.json", 24 * 7, False),
    "financials": ("financials_cache.json", 24 * 30, False),
    "shareholder": ("shareholder_cache.json", 24 * 30, False),
    "volatility": ("volatility_cache.json", 24, True),
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _expiry(ttl_hours: float | None) -> datetime | None:
    return _utcnow() + timedelta(hours=ttl_hours) if ttl_hours else None


# ── 读：单个 code ───────────────────────────────────────────
def get_one(namespace: str, code: str) -> dict | None:
    with session_scope() as s:
        row = s.execute(
            select(Cache).where(Cache.namespace == namespace, Cache.code == code)
        ).scalar_one_or_none()
        if row is None:
            return None
        if row.expires_at and row.expires_at < _utcnow():
            return None  # 过期视同不存在，由调用方决定是否回源
        return row.payload


# ── 读：整个命名空间（按 code 过滤）─────────────────────────
def get_many(namespace: str, codes: list[str] | None = None) -> dict[str, Any]:
    with session_scope() as s:
        stmt = select(Cache).where(Cache.namespace == namespace)
        if codes:
            stmt = stmt.where(Cache.code.in_(codes))
        rows = s.execute(stmt).scalars().all()
        now = _utcnow()
        return {
            r.code: r.payload for r in rows
            if not (r.expires_at and r.expires_at < now)
        }


def get_meta(namespace: str) -> dict:
    with session_scope() as s:
        row = s.execute(
            select(CacheMeta).where(CacheMeta.namespace == namespace)
        ).scalar_one_or_none()
        return row.meta if row else {}


# ── 写：整批 upsert（刷新脚本落盘 json 后同步用）────────────
def set_many(namespace: str, items: dict, ttl_hours: float | None = None) -> int:
    """批量写入某命名空间的全部条目，返回写入行数"""
    n = 0
    for code, payload in items.items():
        set_one(namespace, str(code), payload, ttl_hours)
        n += 1
    return n


# ── 自愈：json 文件比库里新 → 自动重新导入 ───────────────────
def maybe_refresh(namespace: str) -> bool:
    """
    阶段②双写期的兜底机制：
    Python 刷新脚本目前仍只写 data/*.json，库里的数据会滞后。
    这里比对文件 mtime 与库内 updated_at，文件更新就重新导入。
    返回 True 表示本次触发了重新导入。
    """
    src_name, _, _ = NAMESPACES[namespace]
    path = DATA_DIR / src_name
    if not path.exists():
        return False

    file_mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    with session_scope() as s:
        db_latest = s.execute(
            select(func.max(Cache.updated_at)).where(Cache.namespace == namespace)
        ).scalar()

    # 库里没有数据、或文件比库新 → 重新导入
    if db_latest is None or file_mtime > db_latest:
        import_namespace(namespace)
        return True
    return False


# ── 写：upsert 单个（PostgreSQL 的 ON CONFLICT 语义）─────────
def set_one(namespace: str, code: str, payload: Any, ttl_hours: float | None = None) -> None:
    ttl = ttl_hours if ttl_hours is not None else NAMESPACES.get(namespace, ("", None, False))[1]
    with session_scope() as s:
        row = s.execute(
            select(Cache).where(Cache.namespace == namespace, Cache.code == code)
        ).scalar_one_or_none()
        if row is None:
            s.add(Cache(namespace=namespace, code=code, payload=payload, expires_at=_expiry(ttl)))
        else:
            row.payload = payload
            row.expires_at = _expiry(ttl)
            row.updated_at = _utcnow()


def set_meta(namespace: str, meta: dict) -> None:
    with session_scope() as s:
        row = s.execute(
            select(CacheMeta).where(CacheMeta.namespace == namespace)
        ).scalar_one_or_none()
        if row is None:
            s.add(CacheMeta(namespace=namespace, meta=meta))
        else:
            row.meta = meta
            row.updated_at = _utcnow()


# ── 导入：json 文件 → PG（幂等，可重复跑）────────────────────
def import_namespace(namespace: str, *, dry_run: bool = False) -> dict:
    """
    把 data/<file>.json 导入 caches 表，返回对账结果。
    幂等：已存在的 (namespace, code) 直接覆盖（PostgreSQL 的 ON CONFLICT）。
    ⚠ 性能要点：必须在「一个事务 + 一条批量语句」里写完，
      逐条 set_one() 会为每行开关一次事务，60 行就要 1-2 秒（踩过）。
    """
    src_name, ttl, is_block = NAMESPACES[namespace]
    path = DATA_DIR / src_name
    if not path.exists():
        raise FileNotFoundError(path)

    raw_bytes = path.read_bytes()
    obj = json.loads(raw_bytes)

    if is_block:
        # 整块缓存：items 按 code 拆行，其余顶层字段进 cache_meta
        items = obj.get("items") or {}
        meta = {k: v for k, v in obj.items() if k != "items"}
    else:
        items = obj
        meta = {}

    if dry_run:
        return {"namespace": namespace, "rows": len(items), "dry_run": True}

    now = _utcnow()
    exp = _expiry(ttl)

    if items:
        rows = [
            {"namespace": namespace, "code": str(code), "payload": payload,
             "expires_at": exp, "updated_at": now}
            for code, payload in items.items()
        ]
        stmt = pg_insert(Cache).values(rows)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_caches_ns_code",
            set_={"payload": stmt.excluded.payload,
                  "expires_at": stmt.excluded.expires_at,
                  "updated_at": stmt.excluded.updated_at},
        )
        with session_scope() as s:
            s.execute(stmt)
            if meta:
                meta_stmt = pg_insert(CacheMeta).values(namespace=namespace, meta=meta, updated_at=now)
                meta_stmt = meta_stmt.on_conflict_do_update(
                    index_elements=["namespace"],
                    set_={"meta": meta_stmt.excluded.meta, "updated_at": meta_stmt.excluded.updated_at},
                )
                s.execute(meta_stmt)
            s.add(ImportLog(
                source_file=str(path),
                namespace=namespace,
                row_count=len(rows),
                checksum=hashlib.sha256(raw_bytes).hexdigest(),
                note="json → PG 导入",
            ))
    return {"namespace": namespace, "rows": len(items), "meta": bool(meta)}


def verify_namespace(namespace: str) -> dict:
    """对账：PG 里的数据与源 json 逐条比对，返回差异"""
    from ..routers.read_api import normalize  # 复用同一套数值归一逻辑

    src_name, _, is_block = NAMESPACES[namespace]
    obj = json.loads((DATA_DIR / src_name).read_text())
    src = (obj.get("items") or {}) if is_block else obj
    db = get_many(namespace)

    missing = [c for c in src if c not in db]
    extra = [c for c in db if c not in src]
    diff = [c for c in src if c in db and normalize(src[c]) != normalize(db[c])]
    return {
        "namespace": namespace,
        "src_rows": len(src),
        "db_rows": len(db),
        "missing": missing[:10],
        "extra": extra[:10],
        "diff": diff[:10],
        "ok": not missing and not extra and not diff,
    }
