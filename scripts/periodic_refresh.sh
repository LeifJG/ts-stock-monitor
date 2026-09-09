#!/usr/bin/env bash
# ============================================================
# periodic_refresh.sh — 低频数据全量刷新（周更/月更档）
# ============================================================
# 覆盖没有日更链路的缓存（高频的 alert/daily-report 链路不在此列）：
#   1. 股东户数       data/shareholder_cache.json   （周更，季报期才有新数据）
#   2. 恐慌指数/技术   data/fear_tech_cache.json     （周更，2026-06-24 起一直没更新）
#   3. 护城河量化层    data/moat_cache.json          （月更，年报序列驱动）
#   4. 护城河叙述层    data/moat_llm_cache.json      （月更，只补增量：评分变化/过期/缺失）
#   5. 股息率缓存     data/dividend_yields.json     （周更，--refresh 全量强制）
#
# 股票池 = 持仓 ∪ 财务缓存(研究池) —— 与各脚本自身默认口径一致
# 日志：cache/periodic_refresh.log（追加）
# 退出码：最后一个失败步骤决定（供 systemd 判 failed）
# ============================================================
set -u
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE_DIR"
PY="$BASE_DIR/.venv/bin/python3"
LOG="$BASE_DIR/cache/periodic_refresh.log"

mkdir -p "$BASE_DIR/cache"
echo "════ $(date '+%F %T') periodic_refresh 开始 ════" >> "$LOG"

# ── 股票池：持仓 ∪ 财务缓存（研究池）∪ 股息缓存 ──────────────
CODES=$("$PY" - <<'EOF'
import json
codes: list[str] = []
seen: set[str] = set()

def add(c):
    c = str(c).strip()
    if c and c not in seen:
        seen.add(c)
        codes.append(c)

try:
    pf = json.load(open("data/portfolio.json", encoding="utf-8"))
    pf_list = pf if isinstance(pf, list) else (pf.get("positions") or pf.get("data") or [])
    for item in pf_list:
        add(item.get("stockCode") or item.get("code"))
except Exception:
    pass
for f in ("data/financials_cache.json", "data/dividend_yields.json"):
    try:
        for c in json.load(open(f, encoding="utf-8")).keys():
            add(c)
    except Exception:
        pass
print(",".join(codes))
EOF
) 2>>"$LOG"
echo "股票池: $CODES" >> "$LOG"

FAIL=0

run_step() {
  local name="$1"; shift
  echo "── [$name] $(date '+%T')" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    echo "── [$name] OK" >> "$LOG"
  else
    echo "── [$name] FAILED (exit $?)" >> "$LOG"
    FAIL=1
  fi
}

# 1) 股东户数（脚本自带默认清单 = 股息缓存 ∪ 兜底，传入全池更稳）
run_step "股东户数" "$PY" scripts/shareholder_data.py "$CODES"

# 2) 恐慌指数/技术指标
run_step "恐慌技术" "$PY" scripts/fear_tech_data.py "$CODES"

# 3) 股息率（--refresh 全量强制刷新，脚本内部写缓存）
run_step "股息率" "$PY" scripts/dividend_data.py --refresh $CODES

# 4) 护城河量化层（全池重算，输出合并旧缓存）
run_step "护城河量化" "$PY" scripts/moat_data.py

# 5) 护城河叙述层（自带增量判断：新增/评分变化/过期才调 LLM）
run_step "护城河叙述" "$PY" scripts/moat_narrative.py

echo "════ $(date '+%F %T') periodic_refresh 结束 FAIL=$FAIL ════" >> "$LOG"
exit $FAIL
