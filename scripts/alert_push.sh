#!/bin/bash
# ============================================================
# alert_push.sh — 盘中预警检查 + 微信推送（systemd timer 调用）
# ------------------------------------------------------------
# 规则：
#   1. 交易日（周一~五）北京时间 09:20–16:10 之外静默退出
#      （覆盖 A 股 9:30-15:00 与港股 9:30-16:00 两个时段）
#   2. 无触发 / 全部处于去重窗口 → 静默（checker 无输出）
#   3. 有触发 → hermes send 推微信，重试 3 次（间隔 20s）
#   4. 推送全部失败 → 内容落盘 cache/alert_missed.md 防丢
# 测试绕过时段守卫：ALERT_FORCE=1 ./scripts/alert_push.sh
# ============================================================
set -uo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="weixin:o9cq80_yXOgPn_xv2CUZ6fUeLeeU@im.wechat"
HERMES="$HOME/.local/bin/hermes"
mkdir -p "$BASE/cache"

# ── 1. 交易时段守卫（北京时间）─────────────────────────────
if [ "${ALERT_FORCE:-0}" != "1" ]; then
  DOW=$(TZ='Asia/Shanghai' date +%u)          # 1=周一 ... 7=周日
  HM=$(TZ='Asia/Shanghai' date +%-H%M)        # %-H 去前导零，避免被当八进制
  if [ "$DOW" -gt 5 ] || [ "$HM" -lt 920 ] || [ "$HM" -gt 1610 ]; then
    exit 0
  fi
fi

# ── 2. 运行检查引擎（无触发输出为空）──────────────────────
OUT=$(timeout 150 "$BASE/.venv/bin/python3" "$BASE/scripts/alert_checker.py" \
      2>>"$BASE/cache/alert_checker.err" || true)
[ -n "${OUT//[[:space:]]/}" ] || exit 0

# ── 3. 推送微信（重试 3 次；间隔 45s > 微信渠道 30s 限流冷却）──
for i in 1 2 3; do
  if "$HERMES" send --to "$TARGET" "$OUT" --quiet >>"$BASE/cache/alert_push.log" 2>&1; then
    echo "$(date '+%F %T') 推送成功" >> "$BASE/cache/alert_push.log"
    exit 0
  fi
  sleep 45
done

# ── 4. 推送失败兜底：落盘防丢 ──────────────────────────────
echo "$(date '+%F %T') 推送失败(3次)，内容落盘" >> "$BASE/cache/alert_push.log"
printf '%s\n\n===\n\n' "$OUT" >> "$BASE/cache/alert_missed.md"
exit 1
