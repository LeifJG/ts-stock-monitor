# ============================================================
# backend/app/config.py — 全局常量与通用小工具
# ============================================================
# 为什么单独拆这个文件：main.py 和 routers 互相导入会形成
# 「循环导入」（Python 经典坑，和前端两文件互相 import 同理）。
# 把共享常量放低层模块，上层（main/routers）单向导入它，永远安全。

import json
from pathlib import Path

# 项目根目录（backend/app/config.py → 往上两级 = ts-stock-monitor/）
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"       # 现有缓存 json 全在这，阶段①直接读
CACHE_DIR = PROJECT_ROOT / "cache"


def read_json(path: Path, default=None):
    """阶段①的通用小工具：读 json 文件，失败给默认值而不是让接口 500"""
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def filter_codes(data: dict, wanted: list[str] | None) -> dict:
    """按 codes 过滤字典类缓存；不传 codes = 全量"""
    if not wanted:
        return data
    return {k: v for k, v in data.items() if k in wanted}


def parse_codes(codes: str | None) -> list[str] | None:
    """?codes=a,b,c → ['a','b','c']（剔除空格与空段）"""
    if not codes:
        return None
    return [c.strip() for c in codes.split(",") if c.strip()]
