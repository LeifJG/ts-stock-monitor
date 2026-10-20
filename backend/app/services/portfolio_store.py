# ============================================================
# backend/app/services/portfolio_store.py — 持仓读写（json 权威 + PG 镜像）
# ============================================================
# 迁移期铁律：
#   · data/portfolio.json 仍是唯一权威，PG 只是镜像（用于对账与后续查询）
#   · 首次写入前必须已存在当日备份（ensure_backup 自动做）
#   · 写入采用「临时文件 + 原子替换」，避免写一半进程被杀导致文件损坏
# 契约与 Next 侧逐字段一致：
#   GET  /api/portfolio        → {success: true, data: [...]}
#   POST /api/portfolio        → body 为数组，整体覆盖文件
#   POST /api/portfolio/sync   → body {data: [...]}，带分红继承与补仓字段透传

import json
import os
import shutil
import tempfile
from datetime import datetime, timezone

from ..config import DATA_DIR

PORTFOLIO_FILE = DATA_DIR / "portfolio.json"
BACKUP_DIR = DATA_DIR.parent / "backup"

# PG 镜像用的命名空间（与 caches 表共用，不额外建表）
PG_NAMESPACE = "portfolio"
PG_CODE = "__all__"


# ── 时间与数字（对齐 JS 行为）──────────────────────────────

def iso_now_js() -> str:
    """对应 new Date().toISOString()：2026-10-20T06:43:26.055Z（毫秒 3 位 + Z）"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def date_cn_now() -> str:
    """对应 new Date().toLocaleDateString('zh-CN')：2026/10/20"""
    return datetime.now().strftime("%Y/%m/%d")


def js_parse_int(v) -> int:
    """对应 parseInt：取整数前缀，负数与小数字符串都能解析；失败返回 0"""
    import re

    if isinstance(v, bool):
        return 0
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v == v and abs(v) != float("inf") else 0
    if v is None:
        return 0
    m = re.match(r"^\s*([+-]?\d+)", str(v))
    return int(m.group(1)) if m else 0


def js_parse_float(v) -> float | None:
    """对应 parseFloat：解析数字前缀，失败返回 None（下游用 or 0 兜底）"""
    from .portfolio_calc import js_parse_float as _pf

    return _pf(v)


def _pf_or_zero(v) -> float:
    n = js_parse_float(v)
    return n if n is not None else 0.0


# ── 读 ────────────────────────────────────────────────────

def read_portfolio() -> list[dict]:
    """读持仓数组；文件缺失/损坏返回空数组（与 Next 读取失败语义对齐）"""
    if not PORTFOLIO_FILE.exists():
        return []
    try:
        data = json.loads(PORTFOLIO_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ── 读写安全：备份 + 原子写 ────────────────────────────────

def ensure_backup() -> str | None:
    """
    写入前确保有一份备份（同一天只备一次，文件名带日期）。
    迁移期红线：对账通过前绝不丢原始数据。
    """
    if not PORTFOLIO_FILE.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    target = BACKUP_DIR / f"portfolio.json.{stamp}.bak"
    if target.exists():
        return str(target)
    shutil.copy2(PORTFOLIO_FILE, target)
    return str(target)


def normalize_numbers(value):
    """
    整值 float 转 int：JS 的 JSON.stringify(20.0) 输出 20，Python 输出 20.0。
    不做这一步，写出的文件字节就和新旧接口对不上（阶段①踩过同一个坑）。
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {k: normalize_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize_numbers(v) for v in value]
    return value


def write_portfolio(positions: list[dict]) -> None:
    """
    原子写：先写同目录临时文件再 os.replace 覆盖。
    直接 open(...,'w') 若中途异常会留下半截文件，持仓数据丢了没法恢复。
    """
    ensure_backup()
    payload = json.dumps(normalize_numbers(positions), ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(dir=str(PORTFOLIO_FILE.parent), prefix=".portfolio.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp, PORTFOLIO_FILE)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    _mirror_to_pg(positions)


# ── PG 镜像（失败不影响主流程）──────────────────────────────

def _mirror_to_pg(positions: list[dict]) -> None:
    """把持仓整体写进 PG 的 portfolio 命名空间，便于后续对账/查询。"""
    try:
        from . import cache_store

        cache_store.set_one(PG_NAMESPACE, PG_CODE, {"positions": positions, "count": len(positions)})
    except Exception as exc:  # 镜像失败不能阻断 json 写入
        print(f"[portfolio_store] PG 镜像失败（不影响 json 写入）：{exc}")


def read_pg_mirror() -> dict | None:
    try:
        from . import cache_store

        return cache_store.get_one(PG_NAMESPACE, PG_CODE)
    except Exception:
        return None


# ── 同步逻辑（POST /api/portfolio/sync 的 Python 版）────────

def clean_dividends(raw) -> list[dict] | None:
    """
    清洗分红记录：字段齐全且金额有效才保留。
    返回 None = payload 未携带该字段（继承服务端已有）；[] = 显式清空。
    """
    if not isinstance(raw, list):
        return None
    out = []
    for d in raw:
        if not isinstance(d, dict):
            continue
        item = {
            "id": str(d.get("id") or ""),
            "date": str(d.get("date") or ""),
            "perShare": _pf_or_zero(d.get("perShare")),
            "total": _pf_or_zero(d.get("total")),
        }
        if item["date"] and (item["total"] > 0 or item["perShare"] > 0):
            out.append(item)
    return out


def sync_positions(payload: list) -> dict:
    """
    全量同步：过滤坏数据 → 分红继承 → 补仓字段透传 → 覆盖写回。
    返回 {success, count, message}，与 Next 侧一致。
    """
    if not isinstance(payload, list):
        raise ValueError("data 必须是数组")

    portfolio = read_portfolio()

    # 服务端已有的分红（按 code 索引），用于 payload 未携带时继承
    existing_dividends: dict[str, list] = {}
    for p in portfolio:
        if isinstance(p.get("dividends"), list) and p.get("code"):
            existing_dividends[str(p["code"])] = p["dividends"]

    new_positions: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        code = str(item.get("stockCode") or item.get("code") or "").strip()
        shares = js_parse_int(item.get("shares"))
        cost = _pf_or_zero(item.get("costPrice") or item.get("cost") or item.get("buyPrice"))
        # 写入前过滤坏数据（无代码/0 股/无成本价，如 ETF 残留记录）
        if not code or shares <= 0 or cost <= 0:
            continue

        dividends = clean_dividends(item.get("dividends"))
        if dividends is None:
            dividends = existing_dividends.get(code)

        existing = next((p for p in portfolio if str(p.get("code")) == code), None)
        base_shares = js_parse_int(item.get("baseShares")) or shares
        last_add_price = _pf_or_zero(item.get("lastAddPrice"))
        if last_add_price <= 0 and existing:
            last_add_price = _pf_or_zero(existing.get("lastAddPrice"))

        pos: dict = {"code": code, "shares": shares, "cost": cost}

        # 可选字段：与 TS 的 `|| undefined` 等价——0/无效值一律不写入
        price = _pf_or_zero(item.get("currentPrice") or item.get("price"))
        if price:
            pos["price"] = price
        profit = _pf_or_zero(item.get("profit"))
        if profit:
            pos["profit"] = profit
        mv = _pf_or_zero(item.get("marketValue"))
        if mv:
            pos["marketValue"] = mv

        pos["addedAt"] = iso_now_js()
        pos["note"] = f"从银河证券同步 ({date_cn_now()})"

        # 注意：JS 里空数组是 truthy，TS 会照样写出 "dividends": []；
        # 只有「字段不存在」才省略。用 is not None 判断，不能判真假。
        if dividends is not None:
            pos["dividends"] = dividends
        if base_shares != shares:
            pos["baseShares"] = base_shares
        if last_add_price:
            pos["lastAddPrice"] = last_add_price

        new_positions.append(pos)

    write_portfolio(new_positions)
    return {
        "success": True,
        "count": len(new_positions),
        "message": f"同步成功：{len(new_positions)} 条持仓",
    }
