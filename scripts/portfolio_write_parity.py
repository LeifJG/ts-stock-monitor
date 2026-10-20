#!/usr/bin/env python3
"""
scripts/portfolio_write_parity.py — 持仓写路径新旧接口对拍
==========================================================
做法：同一份 payload 分别打旧接口（Next:3000）和新接口（FastAPI:8000），
      把两次写出的 data/portfolio.json 取出来逐字节比对。

安全措施（重要）：
  · 开始前快照 data/portfolio.json 到 /tmp
  · 每轮测试前还原快照
  · 全部结束后无论成败都还原，并校验 sha256 与原始一致
  · 一旦发现不一致，立即还原并中止

时间戳字段（addedAt / note 里的日期）每次调用必然不同，比对时统一抹平。

用法：
  backend/.venv/bin/python3 scripts/portfolio_write_parity.py
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTFOLIO = os.path.join(ROOT, "data", "portfolio.json")
OLD = "http://127.0.0.1:3000"
NEW = "http://127.0.0.1:8000"
ENV_PREFIX = "NO_PROXY='*' HTTP_PROXY= HTTPS_PROXY="

# 对拍用例：覆盖字段优先级、分红继承/清空、补仓透传、坏数据过滤
CASES = [
    {
        "name": "基础同步-两种字段名混用",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"stockCode": "888001", "shares": 300, "buyPrice": 11.11},
                {"code": "02222", "shares": 400, "cost": 33.33},
            ]
        },
    },
    {
        "name": "字段优先级-costPrice > cost > buyPrice",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"code": "888002", "shares": 100, "costPrice": 12.5, "cost": 99.9, "buyPrice": 88.8},
                {"code": "888003", "shares": 100, "cost": 45.6, "buyPrice": 88.8},
            ]
        },
    },
    {
        "name": "坏数据过滤-0股/无代码/无成本",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"code": "888004", "shares": 0, "cost": 10},
                {"code": "", "shares": 100, "cost": 10},
                {"code": "888005", "shares": 100, "cost": 0},
                {"code": "888006", "shares": "150", "cost": "26.5"},
            ]
        },
    },
    {
        "name": "分红显式清空-空数组",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [{"code": "888007", "shares": 200, "cost": 20.0, "dividends": []}]
        },
    },
    {
        "name": "分红字段齐全-保留",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"code": "888008", "shares": 200, "cost": 20.0,
                 "dividends": [{"id": "d1", "date": "2026-07-01", "perShare": 1.5, "total": 300}]}
            ]
        },
    },
    {
        "name": "补仓字段透传-baseShares/lastAddPrice",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"code": "01111", "shares": 800, "cost": 12.5, "baseShares": 600, "lastAddPrice": 11.0}
            ]
        },
    },
    {
        "name": "baseShares等于股数-不写入该字段",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [{"code": "888009", "shares": 500, "cost": 10.0, "baseShares": 500}]
        },
    },
    {
        "name": "行情字段-price/profit/marketValue",
        "endpoint": "/api/portfolio/sync",
        "payload": {
            "data": [
                {"code": "888010", "shares": 100, "cost": 10.0,
                 "currentPrice": 12.3, "profit": 230, "marketValue": 1230}
            ]
        },
    },
    {
        "name": "直接覆盖-POST /api/portfolio 原样写",
        "endpoint": "/api/portfolio",
        "payload": [
            {"code": "888011", "shares": 10, "cost": 1.5, "note": "原样写入"},
        ],
    },
]


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def restore(snapshot: str) -> None:
    shutil.copy2(snapshot, PORTFOLIO)


def read_file() -> bytes:
    return open(PORTFOLIO, "rb").read() if os.path.exists(PORTFOLIO) else b""


def normalize(raw: bytes) -> bytes:
    """抹平每次调用必然不同的时间字段，剩下逐字节比对"""
    txt = raw.decode("utf-8")
    txt = re.sub(r'"addedAt":\s*"[^"]*"', '"addedAt": "<TS>"', txt)
    txt = re.sub(r"从银河证券同步 \([^)]*\)", "从银河证券同步 (<DATE>)", txt)
    return txt.encode("utf-8")


def post(url: str, payload) -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write(body)
        body_path = f.name
    try:
        out = subprocess.run(
            f"{ENV_PREFIX} curl -s -m 25 -o /dev/null -w '%{{http_code}}' "
            f"-X POST -H 'Content-Type: application/json' --data @{body_path} {url}",
            shell=True, capture_output=True, text=True, cwd=ROOT,
        ).stdout.strip()
        return int(out or 0), ""
    finally:
        os.unlink(body_path)


def main() -> int:
    if not os.path.exists(PORTFOLIO):
        print(f"持仓文件不存在：{PORTFOLIO}")
        return 2

    snapshot = os.path.join(tempfile.gettempdir(), "portfolio_snapshot_parity.json")
    shutil.copy2(PORTFOLIO, snapshot)
    original_sha = sha(PORTFOLIO)
    print(f"已快照持仓（sha256 {original_sha[:12]}…），开始对拍\n")

    failures = 0
    try:
        for case in CASES:
            endpoint = case["endpoint"]

            restore(snapshot)
            code_old, _ = post(OLD + endpoint, case["payload"])
            ts_bytes = read_file()

            restore(snapshot)
            # 旧路径 /api/xxx → 新路径 /api/v1/xxx（把前缀插到 /api/ 之后，不是简单拼接）
            new_url = NEW + endpoint.replace("/api/", "/api/v1/", 1)
            code_new, _ = post(new_url, case["payload"])
            py_bytes = read_file()

            restore(snapshot)

            if code_old != 200 or code_new != 200:
                print(f"[{case['name']}] ❌ HTTP 旧={code_old} 新={code_new}")
                failures += 1
                continue

            a, b = normalize(ts_bytes), normalize(py_bytes)
            if a == b:
                print(f"[{case['name']}] ✅ 写出的文件完全一致（{len(ts_bytes)} 字节）")
            else:
                failures += 1
                print(f"[{case['name']}] ❌ 文件内容不同")
                a_lines = a.decode().splitlines()
                b_lines = b.decode().splitlines()
                for i in range(max(len(a_lines), len(b_lines))):
                    la = a_lines[i] if i < len(a_lines) else "<缺>"
                    lb = b_lines[i] if i < len(b_lines) else "<缺>"
                    if la != lb:
                        print(f"    行{i+1}: 旧={la.strip()}")
                        print(f"          新={lb.strip()}")
    finally:
        restore(snapshot)
        final_sha = sha(PORTFOLIO)
        ok = final_sha == original_sha
        print(f"\n持仓已还原（sha256 {final_sha[:12]}…）{'✅ 与原始一致' if ok else '❌ 与原始不一致！'}")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"结论： {failures} 处不一致 ❌")
        return 1
    print("结论： 全部一致 ✅（写路径可安全切换）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
