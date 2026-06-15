#!/bin/bash
# ============================================================
# push-ts-stock-monitor.sh — 一键推送 ts-stock-monitor 到 GitHub
# 在你的 Windows 电脑上运行（需要 Git Bash / WSL）
# ============================================================

# 你的 GitHub Token
TOKEN="ghp_03...Omsg"

echo "=== 推送 A股量化看板到 GitHub ==="
echo ""

cd "$(dirname "$0")"

# 设置远程仓库
git remote remove origin 2>/dev/null
git remote add origin "https://${TOKEN}@github.com/LeifJG/ts-stock-monitor.git"

# 推送
git push -u origin main

echo ""
echo "=== 完成 ==="
echo "仓库地址: https://github.com/LeifJG/ts-stock-monitor"
