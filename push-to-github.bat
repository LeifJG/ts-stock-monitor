#!/bin/bash
# ============================================================
# push-to-github.bat — 在 Windows 上运行此脚本推送到 GitHub
# 双击运行，或右键 → 用 Git Bash 运行
# ============================================================

@echo off
echo === 推送 A股量化看板到 GitHub ===
echo.

cd /d "%~dp0"

:: 设置你的 GitHub Token（从 https://github.com/settings/tokens 生成）
set TOKEN=ghp_你的TOKEN

:: 初始化 Git
git init
git branch -m main
git remote remove origin 2>nul
git remote add origin https://%TOKEN%@github.com/LeifJG/ts-stock-monitor.git

:: 提交
git add -A
git commit -m "🎉 init: A股量化看板 - Next.js + TypeScript"

:: 推送
git push -u origin main

echo.
echo === 完成！===
echo 仓库地址: https://github.com/LeifJG/ts-stock-monitor
pause
