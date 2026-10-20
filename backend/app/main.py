# ============================================================
# backend/app/main.py — ts-stock-monitor 后端（FastAPI）入口
# ============================================================
# 阶段①目标：把 Next.js 现有只读 API 逐个「镜像」到 8000 端口，
# 响应 JSON 必须和旧接口逐字段一致（scripts/phase1_diff.py 验证），
# 前端切换只改 NEXT_PUBLIC_API_BASE 不用动业务代码。
#
# 运行（本机调试）：
#   cd backend && .venv/bin/python3 -m uvicorn app.main:app --port 8000
# 正式运行：systemd user 服务 ts-stock-backend.service（阶段①末配置）

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import DATA_DIR
from .routers import portfolio_api, read_api

app = FastAPI(
    title="ts-stock-monitor backend",
    description="股票监控看板后端 — 阶段③：持仓写路径迁移",
    version="0.3.0",
)

# ── CORS：阶段①先只放行本机 3000（Next 前端），后续有需要再扩 ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 路由挂载：统一前缀 /api/v1，前端经 Next rewrites 代理过来 ──
app.include_router(read_api.router, prefix="/api/v1")
app.include_router(portfolio_api.router, prefix="/api/v1")


# ── 健康检查（systemd 验活 + 排查第一入口） ──────────────────
@app.get("/health")
def health() -> dict:
    """服务存活 + 数据库连通性（阶段②起带 DB 状态）"""
    from sqlalchemy import text

    from .db import get_engine

    db_ok, db_rows = False, 0
    try:
        with get_engine().connect() as conn:
            db_rows = conn.execute(text("select count(*) from caches")).scalar() or 0
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "status": "ok",
        "stage": "phase-3-b portfolio write path",
        "data_dir_exists": DATA_DIR.exists(),
        "db_ok": db_ok,
        "db_cache_rows": db_rows,
    }
