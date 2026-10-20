# ============================================================
# backend/app/models.py — 数据模型（阶段②：缓存表化）
# ============================================================
# 设计取舍：为什么不给 9 种缓存各建一张表？
#   1) 它们结构差异极大（护城河有嵌套 dims/series，估值是扁平数值）
#   2) 彼此没有 join 需求（都是「按股票代码取一块结果」）
#   3) 加一种新缓存只需加一行 namespace，不用写迁移
# 所以用一张 caches 表 + jsonb payload，按 (namespace, code) 唯一。
# 等某类缓存出现高频查询/需要按字段过滤时，再单独拆表。

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from .db import Base


class Cache(Base):
    """通用缓存表：一条记录 = 某命名空间下某只股票（或全局）的一份结果"""

    __tablename__ = "caches"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # 命名空间：moat / moat_llm / fear_tech / valuation / dividend_yields ...
    namespace = Column(String(64), nullable=False)
    # 代码；全局类缓存（如 fx_rate）用空字符串 '' 占位
    code = Column(String(16), nullable=False, default="")
    # 结果本身，原样存 JSON（PostgreSQL 的 jsonb 支持索引与字段查询）
    payload = Column(JSONB, nullable=False)
    # 过期时间；NULL = 永不过期
    expires_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("namespace", "code", name="uq_caches_ns_code"),
        Index("ix_caches_ns_updated", "namespace", "updated_at"),
    )

    def __repr__(self) -> str:
        return f"<Cache {self.namespace}/{self.code or '*'}>"


class CacheMeta(Base):
    """缓存命名空间的元信息：整块缓存的附加字段（如 volatility 的 total/ok/generated_at）"""

    __tablename__ = "cache_meta"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    namespace = Column(String(64), nullable=False, unique=True)
    # 整块缓存的顶层附加信息，例如 {"total": 8, "ok": 8, "generated_at": 1789314530741}
    meta = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<CacheMeta {self.namespace}>"


class ImportLog(Base):
    """导入记录：json → PG 迁移留痕（哪个文件、多少条、对账结果）"""

    __tablename__ = "import_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source_file = Column(Text, nullable=False)
    namespace = Column(String(64), nullable=False)
    row_count = Column(Integer, nullable=False)
    checksum = Column(String(64), nullable=True)  # 源文件 sha256，可复现
    imported_at = Column(DateTime(timezone=True), server_default=func.now())
    note = Column(Text, nullable=True)
