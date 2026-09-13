# -*- coding: utf-8 -*-
"""
scripts/phase1_diff.py — 阶段①验收工具：新旧接口快照 diff
------------------------------------------------------------
用法：
  .venv/bin/python3 scripts/phase1_diff.py          # 默认对比全部镜像接口
  .venv/bin/python3 scripts/phase1_diff.py moat     # 只对比单个接口

原理：同一组 codes 同时请求旧（Next :3000）和新（FastAPI :8000）接口，
递归比对 JSON 结构与值，输出逐字段差异报告。全空 = 镜像合格。
（注意：行情类字段随时间变化，stocks 这类实时接口的 diff 要跳过动态字段）
"""

import json
import sys
import urllib.request

OLD_BASE = "http://127.0.0.1:3000/api"
NEW_BASE = "http://127.0.0.1:8000/api/v1"

# 对比用的测试参数（小规模，避免慢接口拖太久）。
# ⚠ 参数名以旧接口为准：shareholders 用单数 code、valuation 必传 codes
CASES = {
    "moat": "?codes=600519,600036",
    "shareholders": "?code=600519",
    "valuation": "?codes=600519,00700",
    "dividend-yields": "?codes=600519,00941",
    "volatility": "?codes=600519",
    "fx": "",
}

# 行情实时字段（随刷新时间变化，允许值不同）——阶段①主要镜像静态缓存，
# 这个列表不断扩大到阶段③接管实时接口为止
DYNAMIC_KEYS = set()


def fetch(url: str, timeout: int = 20):
    """带 UA 的 GET；非 200 抛异常让上层标注 FAIL"""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def diff(old, new, path: str = "", issues: list[str] | None = None) -> list[str]:
    """递归对比两棵 JSON，返回差异描述列表（空 = 一致）"""
    issues = issues if issues is not None else []
    key = path.split(".")[-1] if path else ""
    if key in DYNAMIC_KEYS:
        return issues  # 动态字段跳过

    if type(old) is not type(new):
        issues.append(f"{path or '<root>'}: 类型不一致 old={type(old).__name__} new={type(new).__name__}")
    elif isinstance(old, dict):
        for k in sorted(set(old) | set(new)):
            if k not in old:
                issues.append(f"{path}.{k}: 新接口多出字段")
            elif k not in new:
                issues.append(f"{path}.{k}: 新接口缺字段")
            else:
                diff(old[k], new[k], f"{path}.{k}" if path else k, issues)
    elif isinstance(old, list):
        if len(old) != len(new):
            issues.append(f"{path}: 长度 old={len(old)} new={len(new)}")
        else:
            for i, (a, b) in enumerate(zip(old, new)):
                diff(a, b, f"{path}[{i}]", issues)
    elif old != new:
        issues.append(f"{path}: 值不同 old={old!r} new={new!r}")
    return issues


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else None
    cases = CASES.items() if not which else [(k, v) for k, v in CASES.items() if k == which]
    if not cases:
        print(f"没有叫 {which} 的用例，可选: {', '.join(CASES)}")
        sys.exit(1)

    all_ok = True
    for name, qs in cases:
        try:
            old = fetch(f"{OLD_BASE}/{name}{qs}")
        except Exception as e:
            print(f"[{name}] 旧接口拉取失败: {e}")
            all_ok = False
            continue
        try:
            new = fetch(f"{NEW_BASE}/{name}{qs}")
        except Exception as e:
            print(f"[{name}] ❌ 新接口失败: {e}")
            all_ok = False
            continue
        issues = diff(old, new)
        if issues:
            all_ok = False
            print(f"[{name}] ❌ {len(issues)} 处差异：")
            for i in issues[:10]:
                print(f"    - {i}")
            if len(issues) > 10:
                print(f"    ... 还有 {len(issues) - 10} 处")
        else:
            print(f"[{name}] ✅ 逐字段一致")

    print("\n结论：", "全部通过 ✅" if all_ok else "存在差异 ❌")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
