#!/usr/bin/env python3
"""
moat_narrative.py — 护城河叙述层（LLM 生成）

输入：data/moat_cache.json（量化引擎的输出：评分/维度事实/ROIC·毛利率序列）
输出：data/moat_llm_cache.json（每公司一份叙述，90 天 TTL，离线批量生成）

设计原则：
  - LLM 只做叙述不做判断：护城河分数由规则引擎算（可解释可复现），
    LLM 负责「护城河是什么类型、为什么、可持续性、主要威胁」四段
  - prompt 强制引用量化事实（ROIC 序列/毛利率/分红），降低幻觉
  - 离线生成：不在 API 请求路径上调 LLM，页面零延迟零 token 消耗
  - 白名单校验：护城河类型只能是给定枚举，防止 LLM 自由发挥

用法：
  python3 moat_narrative.py            # 处理 moat_cache 里全部未生成的
  python3 moat_narrative.py 600066 ... # 指定代码强制刷新
"""

import os
import re
import sys
import json
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from net_utils import setup_proxy_env

setup_proxy_env()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MOAT_CACHE = DATA_DIR / "moat_cache.json"
LLM_CACHE = DATA_DIR / "moat_llm_cache.json"
AUTH_FILE = Path("/mnt/c/Users/Administrator/.local/share/opencode/auth.json")

TTL_MS = 90 * 24 * 3600 * 1000  # 90 天

# 护城河类型白名单（Morningstar 五来源 + 常用组合）
MOAT_TYPES = [
    "品牌", "转换成本", "网络效应", "成本优势", "无形资产", "有效规模",
    "资源垄断", "牌照壁垒", "技术专利", "渠道优势",
]

SYSTEM_PROMPT = """你是严谨的股票基本面分析师，擅长用 Morningstar 经济护城河框架分析 A股/港股公司。
你会收到一份量化事实（护城河评分、五维度得分、ROIC/毛利率序列、负债率、股息率）。
你的任务：基于这些事实（可补充你对公司业务的常识，但不得编造具体数字），输出该公司的护城河叙述。

严格输出 JSON（不要 markdown 代码块），结构：
{
  "moat_type": "护城河类型（从给定列表选1-3个，顿号分隔）",
  "moat_summary": "一句话护城河概括（<=40字）",
  "moat_desc": "护城河描述段落（150-250字）：公司靠什么挡住竞争者，须引用量化事实（如 ROIC 连续X年超资金成本、毛利率稳定在X%），结合业务实际（如产品格局、客户粘性来源）",
  "moat_strengths": ["支撑点1（一句话，须带数据或业务事实）", "支撑点2", "支撑点3"],
  "moat_risks": ["侵蚀风险1（一句话）", "风险2"],
  "durability": "可持续性判断：'10年以上' | '5-10年' | '3-5年' | '不确定'",
  "durability_reason": "判断依据（一句话）"
}

要求：
  - 全部中文；事实与常识冲突时以给定的量化数据为准
  - moat_desc 必须落到具体业务（谁在用、为什么离不开、竞争者难在哪），不许空话
  - 评分低（<60）时如实描述护城河薄弱或缺失，不硬凑
"""

MOAT_TYPE_LIST = "、".join(MOAT_TYPES)


def get_api_config() -> tuple[str, str]:
    """从 opencode auth.json 拿 base_url + key"""
    cfg = json.loads(AUTH_FILE.read_text())
    entry = cfg.get("opencode-go", {})
    key = entry.get("key")
    if not key:
        raise RuntimeError("opencode-go key 不存在")
    return "https://opencode.ai/zen/go/v1", key


def call_llm(base_url: str, key: str, user_prompt: str, model: str = "glm-5.3-flash",
             timeout: int = 120) -> str:
    import uuid
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                 # opencode 网关要求：无此头返回 400 MissingSessionID
                 "x-opencode-session": str(uuid.uuid4())})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def call_llm_with_retry(base_url: str, key: str, user_prompt: str,
                        model: str = "glm-5.3-flash", timeout: int = 90,
                        attempts: int = 2) -> str:
    """短超时 + 一次重试：批量模式下挂死的请求直接跳过，不拖死整池"""
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            return call_llm(base_url, key, user_prompt, model, timeout)
        except Exception as e:
            last_err = e
            time.sleep(2)
    raise last_err if last_err else RuntimeError("unknown LLM error")


def parse_narrative(text: str) -> dict | None:
    """解析 LLM 输出 JSON（容忍 ```json 包裹），校验白名单字段"""
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    required = ["moat_type", "moat_summary", "moat_desc", "moat_strengths",
                "moat_risks", "durability", "durability_reason"]
    if not all(k in obj for k in required):
        return None
    if not isinstance(obj["moat_strengths"], list) or not isinstance(obj["moat_risks"], list):
        return None
    obj["moat_strengths"] = [str(x)[:80] for x in obj["moat_strengths"][:4]]
    obj["moat_risks"] = [str(x)[:80] for x in obj["moat_risks"][:4]]
    obj["moat_desc"] = str(obj["moat_desc"])[:400]
    obj["moat_summary"] = str(obj["moat_summary"])[:60]
    # moat_type 清洗：只保留白名单词
    words = re.split(r"[、，,/\s]+", str(obj["moat_type"]))
    valid = [w for w in words if w in MOAT_TYPES]
    obj["moat_type"] = "、".join(valid[:3]) if valid else "综合优势"
    return obj


def build_user_prompt(code: str, name: str, moat: dict) -> str:
    dims = moat.get("dims", {})
    series = moat.get("series", {})
    roic = series.get("roic", [])
    gm = series.get("grossMargin", [])
    lines = [
        f"公司：{name}（{'港股' if len(code) == 5 else 'A股'} {code}）",
        f"护城河总分：{moat.get('score')} / 100 → {moat.get('ratingLabel')}",
        f"护城河类型候选（从中选）：{MOAT_TYPE_LIST}",
        "",
        "五维度得分：",
    ]
    for k, v in dims.items():
        detail = {kk: vv for kk, vv in v.items() if kk not in ("score", "max")}
        lines.append(f"  - {k}: {v.get('score')}/{v.get('max')} {detail if detail else ''}")
    lines.append("")
    if roic:
        lines.append("ROIC/ROE 年度序列（%）： " + ", ".join(f"{d}:{v}" for d, v in roic[-8:]))
    if gm:
        lines.append("毛利率年度序列（%）： " + ", ".join(f"{d}:{v}" for d, v in gm[-8:]))
    lines.append("")
    lines.append("请输出该公司的护城河叙述 JSON。")
    return "\n".join(lines)


def main():
    codes = sys.argv[1:] if len(sys.argv) > 1 else []
    moat_all = json.loads(MOAT_CACHE.read_text()) if MOAT_CACHE.exists() else {}
    llm_all = json.loads(LLM_CACHE.read_text()) if LLM_CACHE.exists() else {}

    if not codes:
        # 全量：moat_cache 里没有有效叙述或已过期的
        now = int(time.time() * 1000)
        for code, moat in moat_all.items():
            entry = llm_all.get(code)
            if (not entry or now - entry.get("generated_at", 0) > TTL_MS
                    or entry.get("score") != moat.get("score")):
                codes.append(code)
        print(f"待生成叙述: {len(codes)} 只")
    if not codes:
        print("全部叙述均为最新，无需生成")
        return

    base_url, key = get_api_config()

    # 名称：从 valuation_cache 拿不到（只有代码），从持仓/advice 缓存拿，最后退化为代码
    names: dict[str, str] = {}
    try:
        adv = json.loads((DATA_DIR / "advice_cache.json").read_text())
        for a in adv.get("data", {}).get("advice", []):
            names[a["stockCode"]] = a.get("stockName", "")
    except Exception:
        pass

    ok = 0
    for code in codes:
        moat = moat_all.get(code)
        if not moat:
            print(f"  ✗ {code}: moat_cache 无量化数据，跳过")
            continue
        name = names.get(code) or code
        prompt = build_user_prompt(code, name, moat)
        try:
            text = call_llm_with_retry(base_url, key, prompt, timeout=90)
            narrative = parse_narrative(text)
            if not narrative:
                print(f"  ✗ {code}: LLM 输出解析失败")
                continue
            narrative.update({
                "code": code,
                "name": name,
                "score": moat.get("score"),
                "rating": moat.get("rating"),
                "ratingLabel": moat.get("ratingLabel"),
                "generated_at": int(time.time() * 1000),
            })
            llm_all[code] = narrative
            ok += 1
            print(f"  ✓ {name}: {narrative['moat_type']} | {narrative['moat_summary']}")
        except Exception as e:
            print(f"  ✗ {code}: LLM 调用失败 {str(e)[:80]}")
        time.sleep(1)

    LLM_CACHE.write_text(json.dumps(llm_all, ensure_ascii=False, indent=2))
    print(json.dumps({"success": ok > 0, "ok": ok, "total": len(codes)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
