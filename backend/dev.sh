# ============================================================
# backend/dev.sh — 本地开发调试辅助脚本
# ============================================================
# 用法：
#   ./dev.sh up        前台启动带热重载（改代码自动重启，调试用）
#   ./dev.sh svc       后台 systemd 服务方式（日常跑，不热重载）
#   ./dev.sh test      跑全部单测
#   ./dev.sh psql      进 PostgreSQL 命令行
#   ./dev.sh tables    看表结构和行数
#   ./dev.sh logs      看服务日志
#
# 注意：up 和 svc 会争用 8000 端口，切之前先停另一个。

set -e
cd "$(dirname "$0")"
PY=".venv/bin/python3"
PSQL=".venv/lib/python3.12/site-packages/pgserver/pginstall/bin/psql"
PGDATA="$(pwd)/.pgdata"

case "${1:-up}" in
  up)
    echo "→ 前台热重载模式（Ctrl+C 退出；改 .py 文件自动重启）"
    echo "→ 接口文档: http://127.0.0.1:8000/docs"
    exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
    ;;
  svc)
    echo "→ 切回 systemd 后台服务模式"
    systemctl --user restart ts-stock-backend
    sleep 3
    systemctl --user is-active ts-stock-backend
    ;;
  test)
    exec "$PY" -m pytest tests/ -v
    ;;
  psql)
    echo "→ 进 PostgreSQL 命令行（\\q 退出，\\dt 看表）"
    exec "$PSQL" -h "$PGDATA" -U postgres
    ;;
  tables)
    "$PSQL" -h "$PGDATA" -U postgres -c "\dt"
    "$PSQL" -h "$PGDATA" -U postgres -c \
      "select namespace, count(*) as rows, max(updated_at) as latest
       from caches group by namespace order by namespace;"
    ;;
  logs)
    exec journalctl --user -u ts-stock-backend -f
    ;;
  *)
    echo "用法: ./dev.sh {up|svc|test|psql|tables|logs}"
    exit 1
    ;;
esac
