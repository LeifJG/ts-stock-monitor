#!/usr/bin/env bash
# fear_tech_refresh.sh — 自动刷新恐慌指数技术指标缓存
# 从 portfolio.json 和页面数据中读取股票代码，传给 fear_tech_data.py
set -euf -o pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE_DIR"

# 从 portfolio.json 读取持仓代码
CODES=""
if [ -f "$BASE_DIR/data/portfolio.json" ]; then
  CODES=$(python3 -c "
import json
try:
    data = json.load(open('$BASE_DIR/data/portfolio.json'))
    codes = [p.get('stockCode','') for p in data if p.get('stockCode')]
    print(','.join(codes))
except: pass
" 2>/dev/null || true)
fi

# 如果持仓为空，使用默认大盘覆盖的代码
if [ -z "$CODES" ]; then
  CODES="600519,600900,000333,600036,601398,000858,600809"
fi

exec python3 "$BASE_DIR/scripts/fear_tech_data.py" "$CODES" 2>/dev/null
