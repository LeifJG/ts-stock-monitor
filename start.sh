#!/bin/bash
# ts-stock-monitor 启动脚本
# 用法: ./start.sh

cd "$(dirname "$0")" || exit 1

PORT="${1:-3000}"

echo "🚀 启动 ts-stock-monitor (端口 $PORT) ..."

# 检查是否已有进程占用端口
if lsof -i :"$PORT" -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN; then
    echo "⚠️  端口 $PORT 已被占用，尝试杀掉旧进程..."
    kill "$(lsof -ti :"$PORT")" 2>/dev/null
    sleep 1
fi

# 启动 Next.js
npx next start -p "$PORT" -H 0.0.0.0 &

sleep 3

# 验证
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" | grep -q 200; then
    echo "✅ 启动成功！ http://172.28.248.8:$PORT"
else
    echo "❌ 启动失败，请检查日志"
    exit 1
fi
