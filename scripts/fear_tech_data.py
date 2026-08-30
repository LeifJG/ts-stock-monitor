#!/usr/bin/env python3
"""
fear_tech_data.py — 恐慌指数技术指标数据模块

为每只股票计算：
  - RSI(14)
  - 价格 vs MA20 偏离度
  - 量比（当日量 / 20日均量）
  - 5日累计涨跌幅
  - 20日平均振幅

数据来源：akshare 历史 K 线 → 东财行情
缓存路径：data/fear_tech_cache.json
"""

import json
import os
import sys
import math
import concurrent.futures
from datetime import datetime, timedelta

# 项目根目录
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_FILE = os.path.join(BASE_DIR, "data", "fear_tech_cache.json")

# ─── 代理配置 ──────────────────────────────────────────────────
# P1-6: 动态探测 Clash（直连优先），统一走共享网络模块
from net_utils import setup_proxy_env as ensure_proxy_env
if __name__ == "__main__":
    main()
