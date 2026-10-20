# ============================================================
# backend/app/db.py — 数据库连接与会话
# ============================================================
# 学到这里要抓的几个概念（前端视角）：
#   Engine   ≈ 数据库连接池（≈ Prisma Client 实例，但更底层）
#   Session  ≈ 一次事务上下文（≈ prisma.$transaction 的作用域）
#   Base     ≈ 所有模型的基类（≈ Prisma schema 的声明载体）
#
# 本项目用 pgserver：把 PostgreSQL 16 的可执行文件打包进 Python 包，
# 不需要 sudo / Docker 就能跑真实 PG。想切原生 PG 或 Docker 时，
# 只改 DATABASE_URL 即可，代码一行不动。

import os
from contextlib import contextmanager

import pgserver
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# 数据目录放在项目内并 gitignore；PG 的 unix socket 也在这个目录下
PGDATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".pgdata")

# 优先级：环境变量 > pgserver 内嵌实例
DATABASE_URL = os.environ.get("DATABASE_URL")

_engine = None
_SessionLocal = None

Base = declarative_base()


def get_engine():
    """惰性初始化引擎（首次调用时顺带拉起 PG 进程）"""
    global _engine, DATABASE_URL
    if _engine is None:
        if not DATABASE_URL:
            # pgserver 会启动（或复用）本地 PG 实例，返回 unix socket URI
            srv = pgserver.get_server(PGDATA)
            DATABASE_URL = srv.get_uri()
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)
    return _SessionLocal


@contextmanager
def session_scope():
    """事务作用域：正常退出提交，异常回滚（≈ 手写 try/commit/rollback 的封装）"""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db():
    """FastAPI 依赖注入用：每个请求一个 session，请求结束自动关闭"""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
