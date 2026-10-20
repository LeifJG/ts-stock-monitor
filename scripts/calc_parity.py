#!/usr/bin/env python3
"""
scripts/calc_parity.py — TS 与 Python 持仓计算一致性验收
==========================================================
流程：
  1. 先跑 TS 侧导出基准：pnpm exec vitest run tests/calc-parity-dump.test.ts
  2. 本脚本吃同一份夹具，用 Python 移植版计算
  3. 逐 case、逐持仓、逐字段比对，任何差异都打印出来

用法：
  backend/.venv/bin/python3 scripts/calc_parity.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.services import portfolio_calc as pc  # noqa: E402

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "calc_cases.json")
TS_OUT = os.path.join(ROOT, "tests", "fixtures", "ts_calc_output.json")


def cmp_value(path: str, ts, py, diffs: list) -> None:
    """递归比对，数值按严格相等（移植目标就是完全一致，不留容差）"""
    if isinstance(ts, dict) and isinstance(py, dict):
        for k in set(ts) | set(py):
            if k not in ts:
                diffs.append(f"{path}.{k}: Python 多出该字段 ({py[k]!r})")
            elif k not in py:
                diffs.append(f"{path}.{k}: Python 缺少该字段 (TS={ts[k]!r})")
            else:
                cmp_value(f"{path}.{k}", ts[k], py[k], diffs)
    elif isinstance(ts, list) and isinstance(py, list):
        if len(ts) != len(py):
            diffs.append(f"{path}: 长度不同 TS={len(ts)} PY={len(py)}")
            return
        for i, (a, b) in enumerate(zip(ts, py)):
            cmp_value(f"{path}[{i}]", a, b, diffs)
    else:
        if type(ts) is not type(py) and not (isinstance(ts, (int, float)) and isinstance(py, (int, float))):
            diffs.append(f"{path}: 类型不同 TS={type(ts).__name__} PY={type(py).__name__} ({ts!r} vs {py!r})")
        elif ts != py:
            diffs.append(f"{path}: 值不同 TS={ts!r} PY={py!r}")


def real_portfolio_check() -> int:
    """
    用真实持仓（data/portfolio.json）+ 真实汇率做一次对比：
    TS 基准由 vitest 侧另存一份 ts_calc_output_real.json（见 calc-parity-dump.test.ts）
    这一步验证的是「真实数据归一化」，不是造出来的夹具。
    """
    real_ts = os.path.join(ROOT, "tests", "fixtures", "ts_calc_output_real.json")
    if not os.path.exists(real_ts):
        print("\n[真实持仓] 跳过（缺 ts_calc_output_real.json，先跑 vitest）")
        return 0

    ts = json.loads(open(real_ts, encoding="utf-8").read())
    raw = json.loads(open(os.path.join(ROOT, "data", "portfolio.json"), encoding="utf-8").read())
    assert pc.set_hkd_rate(ts["fxRate"]), "汇率注入失败"

    positions = pc.normalize_positions(raw)
    stock_map = ts.get("stockData") or {}
    py = {
        "droppedByNormalize": len(raw) - len(positions),
        "perPosition": [
            {
                "normalized": {
                    k: v for k, v in pos.items()
                    if k not in ("dividends", "buyDate", "stockName")
                },
                "metrics": pc.calc_position_metrics(pos, stock_map.get(pos["stockCode"])),
            }
            for pos in positions
        ],
        "summary": pc.calc_portfolio_summary(positions, stock_map),
    }

    # 对齐字段集合（TS 侧没输出 stockName / dividends / buyDate）
    for a, b in zip(ts["perPosition"], py["perPosition"]):
        keys = set(a["normalized"]) & set(b["normalized"])
        a["normalized"] = {k: a["normalized"][k] for k in keys}
        b["normalized"] = {k: b["normalized"][k] for k in keys}

    diffs: list[str] = []
    cmp_value("real", {k: v for k, v in ts.items() if k in ("droppedByNormalize", "perPosition", "summary")},
              py, diffs)

    if diffs:
        print(f"\n[真实持仓] ❌ {len(diffs)} 处差异")
        for d in diffs[:10]:
            print(f"    - {d}")
        return len(diffs)
    print(f"\n[真实持仓] ✅ 逐字段一致（{len(positions)} 只持仓，过滤掉 {py['droppedByNormalize']} 条坏数据）")
    return 0


def main() -> int:
    if not os.path.exists(TS_OUT):
        print("缺少 TS 基准文件，先跑：pnpm exec vitest run tests/calc-parity-dump.test.ts")
        return 2

    fixture = json.loads(open(FIXTURE, encoding="utf-8").read())
    ts = json.loads(open(TS_OUT, encoding="utf-8").read())

    # 汇率注入（两边同一份）
    assert pc.set_hkd_rate(fixture["fxRate"]), "汇率注入失败（超出合理区间 0.75~0.98）"

    total_diffs = 0
    for case, ts_case in zip(fixture["cases"], ts["results"]):
        positions = pc.normalize_positions(case["positions"])
        stock_map = case.get("stockData") or {}

        py_case = {
            "name": case["name"],
            "droppedByNormalize": len(case["positions"]) - len(positions),
            "perPosition": [
                {
                    "normalized": {
                        k: v for k, v in pos.items()
                        if k not in ("dividends", "buyDate")
                    },
                    "metrics": pc.calc_position_metrics(pos, stock_map.get(pos["stockCode"])),
                }
                for pos in positions
            ],
            "summary": pc.calc_portfolio_summary(positions, stock_map),
        }
        # 只保留 TS 侧存在的 tracked 字段（TS 的 normalized 没输出 dividends/buyDate）
        for a, b in zip(ts_case["perPosition"], py_case["perPosition"]):
            b["normalized"] = {k: b["normalized"][k] for k in a["normalized"] if k in b["normalized"]}

        diffs: list[str] = []
        cmp_value("case", {k: v for k, v in ts_case.items() if k != "name"},
                  {k: v for k, v in py_case.items() if k != "name"}, diffs)

        if diffs:
            total_diffs += len(diffs)
            print(f"[{case['name']}] ❌ {len(diffs)} 处差异")
            for d in diffs[:8]:
                print(f"    - {d}")
        else:
            print(f"[{case['name']}] ✅ 逐字段一致")

    print()
    total_diffs += real_portfolio_check()
    if total_diffs:
        print(f"结论： {total_diffs} 处差异 ❌")
        return 1
    print("结论： 全部通过 ✅（TS 与 Python 计算完全一致）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
