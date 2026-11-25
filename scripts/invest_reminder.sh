#!/bin/bash
# ============================================================
# invest_reminder.sh — 定投提醒的 shell 包装（供 systemd 调用）
# ------------------------------------------------------------
# 为什么要有这层：systemd 的 ExecStart 不按 shell 规则解析引号，
# 把 $(...) / && / if 写进 ExecStart 会报 "bad unit file setting"。
# 逻辑放脚本里，unit 只负责调用。
#
# 行为：非定投日脚本无输出 → 什么都不做（静默）；定投日才推微信。
# ============================================================
set -u

cd /home/lijg/ts-stock-monitor || exit 1
mkdir -p cache

OUT=$(.venv/bin/python3 scripts/invest_reminder.py 2>>cache/invest_reminder.err)

if [ -n "${OUT}" ]; then
  printf "%s" "${OUT}" > /tmp/invest_reminder.txt
  if ! hermes send -t weixin -f /tmp/invest_reminder.txt; then
    # iLink 会话过期时主动推送会失败（协议限制：需用户先发消息激活）
    echo "$(date +%F_%T) 推送失败(多为 iLink 会话过期，等用户发消息即可恢复)" >> cache/invest_reminder.err
  fi
fi

exit 0
