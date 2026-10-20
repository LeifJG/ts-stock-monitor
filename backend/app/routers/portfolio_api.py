# ============================================================
# backend/app/routers/portfolio_api.py — 持仓读写接口（阶段③-b）
# ============================================================
# 三个接口与 Next 侧完全同契约，前端只改 base 即可切换：
#   GET  /api/v1/portfolio          → {success, data:[...]}
#   POST /api/v1/portfolio          → body 为数组，整体覆盖
#   POST /api/v1/portfolio/sync     → body {data:[...]}，带分红继承/补仓透传
# 另加两个迁移值守接口（Next 侧没有）：
#   GET  /api/v1/portfolio/reconcile → json 与 PG 镜像逐字段对账
#   GET  /api/v1/portfolio/backup    → 查看备份状态

from fastapi import APIRouter, HTTPException, Request

from ..services import portfolio_store as store

router = APIRouter()


@router.get("/portfolio")
def get_portfolio():
    """读取持仓（json 为权威）"""
    return {"success": True, "data": store.read_portfolio()}


@router.post("/portfolio")
async def put_portfolio(request: Request):
    """整体覆盖持仓（对应 Next 的 POST /api/portfolio，不做任何字段加工）"""
    try:
        positions = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON")
    if not isinstance(positions, list):
        raise HTTPException(status_code=400, detail="data 必须是数组")
    try:
        store.write_portfolio(positions)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"写入持仓文件失败: {exc}")
    return {"success": True, "message": "持仓数据已更新"}


@router.post("/portfolio/sync")
async def sync_portfolio(request: Request):
    """银河同步全量覆盖（对应 Next 的 POST /api/portfolio/sync）"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON")

    data = body.get("data") if isinstance(body, dict) else body
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="data 必须是数组")
    try:
        return store.sync_positions(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"同步失败: {exc}")


@router.post("/portfolio/mirror/refresh")
def refresh_mirror():
    """
    用 json（权威）重建 PG 镜像。
    场景：json 被外部脚本改动过（如对拍脚本还原快照），镜像会滞后；
    镜像本身是派生数据，随时可从 json 重建，不存在丢数据风险。
    """
    positions = store.read_portfolio()
    store._mirror_to_pg(positions)
    return {"success": True, "count": len(positions), "message": f"镜像已重建：{len(positions)} 条"}


@router.get("/portfolio/reconcile")
def reconcile_portfolio(fix: bool = False):
    """
    迁移期对账：json（权威）vs PG 镜像，逐条比对。
    对账不通过就不允许切前端流量。
    """
    if fix:
        store._mirror_to_pg(store.read_portfolio())

    json_list = store.read_portfolio()
    mirror = store.read_pg_mirror() or {}
    pg_list = mirror.get("positions") or []

    diffs: list[str] = []
    if len(json_list) != len(pg_list):
        diffs.append(f"条数不同：json {len(json_list)} / PG {len(pg_list)}")

    fields = ("code", "shares", "cost", "baseShares", "lastAddPrice")
    for i, jp in enumerate(json_list):
        pp = pg_list[i] if i < len(pg_list) else {}
        for f in fields:
            jv, pv = jp.get(f), pp.get(f)
            if jv != pv:
                diffs.append(f"[{i}] {jp.get('code')} 字段 {f}: json={jv!r} PG={pv!r}")
        # 分红条数也要对齐
        jd = len(jp.get("dividends") or [])
        pd = len(pp.get("dividends") or [])
        if jd != pd:
            diffs.append(f"[{i}] {jp.get('code')} 分红条数: json={jd} PG={pd}")

    return {
        "success": not diffs,
        "json_count": len(json_list),
        "pg_count": len(pg_list),
        "diff_count": len(diffs),
        "diffs": diffs[:20],
    }


@router.get("/portfolio/backup")
def backup_status():
    """备份状态：迁移期用来确认「动手前确实备份过」"""
    backup = store.ensure_backup()
    return {
        "success": True,
        "portfolio_file": str(store.PORTFOLIO_FILE),
        "exists": store.PORTFOLIO_FILE.exists(),
        "backup_path": backup,
        "backup_exists": bool(backup),
    }
