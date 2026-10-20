#!/usr/bin/env python3
"""
scripts/import_caches.py — 把 data/*.json 缓存全部导入 PostgreSQL
------------------------------------------------------------------
用法：
  backend/.venv/bin/python3 scripts/import_caches.py            # 全量导入 + 对账
  backend/.venv/bin/python3 scripts/import_caches.py moat       # 只导一个命名空间
  backend/.venv/bin/python3 scripts/import_caches.py --verify   # 只对账不导入

幂等：可重复执行，已存在的记录会被覆盖。
风险控制：只读源 json，不删除、不改写任何原始文件。
"""
import os
import sys

# 让脚本能 import backend/app 里的模块
BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND))

from app.db import Base, get_engine  # noqa: E402
from app.services import cache_store  # noqa: E402


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    verify_only = "--verify" in sys.argv

    # 建表（阶段②用 create_all，阶段③接 Alembic 管理迁移）
    Base.metadata.create_all(get_engine())
    print("✓ 数据表就绪（caches / cache_meta / import_log）\n")

    namespaces = args if args else list(cache_store.NAMESPACES.keys())

    print(f"{'命名空间':<18}{'导入':>6}{'源':>6}{'库':>6}{'对账':>8}")
    print("-" * 46)
    all_ok = True
    for ns in namespaces:
        try:
            res = {"rows": "-"}
            if not verify_only:
                res = cache_store.import_namespace(ns)
            v = cache_store.verify_namespace(ns)
            flag = "✓" if v["ok"] else f"✗ 缺{len(v['missing'])}/多{len(v['extra'])}/异{len(v['diff'])}"
            all_ok = all_ok and v["ok"]
            print(f"{ns:<18}{res.get('rows', '-'):>6}{v['src_rows']:>6}{v['db_rows']:>6}{flag:>8}")
        except Exception as e:
            all_ok = False
            print(f"{ns:<18}{'FAIL':>6}  {str(e)[:40]}")

    print("\n结论：", "全部一致 ✅" if all_ok else "存在差异 ❌")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
