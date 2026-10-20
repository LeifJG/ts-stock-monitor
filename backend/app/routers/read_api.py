# ============================================================
# backend/app/routers/read_api.py — 阶段①/②：只读 API
# ============================================================
# 阶段①：全部直接读 data/*.json
# 阶段②：改读 PostgreSQL（caches 表），json 文件保留为兜底源
#          —— 双读并行，任一侧出问题页面都不会白屏
#
# 响应 JSON 必须和旧 Next 接口「逐字段一致」，
# 验收工具：scripts/phase1_diff.py（新旧接口逐字段 diff）
#
# FastAPI 写法速记（对前端）：
#   @router.get("/xxx")   ≈ app/api/xxx/route.ts 的 export async function GET
#   Query(default=None)   ≈ request.nextUrl.searchParams.get()
#   返回 dict             ≈ NextResponse.json(...)（FastAPI 自动序列化）
#
# ⚠ 数值精度坑（2026-09-13 踩过）：TS 的 JSON.stringify(77.0) 输出 77，
#   Python 的 json.dumps(77.0) 输出 77.0——镜像层要过 normalize()。

import logging

from fastapi import APIRouter, HTTPException, Query

from ..config import CACHE_DIR, DATA_DIR, filter_codes, parse_codes, read_json
from ..services import cache_store

router = APIRouter()
logger = logging.getLogger(__name__)


def normalize(obj):
    """递归把「值为整数的 float」转回 int，对齐 JS 的序列化行为"""
    if isinstance(obj, dict):
        return {k: normalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize(v) for v in obj]
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    return obj


def load_cache(namespace: str, codes: str | None, fallback_file: str) -> dict:
    """
    阶段②核心读取函数：优先 PostgreSQL，DB 无数据/不可用则回落 json 文件。
    双读期留痕：DB 未命中会打日志，便于判断迁移进度。
    另外每次读前做「文件变更自愈」——json 比库里新就自动重新导入，
    保证 Python 刷新脚本（只写 json）的更新不会在 PG 侧丢失。
    """
    wanted = parse_codes(codes)
    try:
        if cache_store.maybe_refresh(namespace):
            logger.info("缓存 %s 的 json 文件有更新，已自动同步进 PostgreSQL", namespace)
        rows = cache_store.get_many(namespace, wanted)
        if rows:
            return rows
        logger.info("缓存 %s 在 PG 中无数据（或已过期），回落 json 文件", namespace)
    except Exception as e:  # DB 不可用时不阻断服务
        logger.warning("读取 PG 缓存 %s 失败，回落 json：%s", namespace, e)

    data = read_json(DATA_DIR / fallback_file) or {}
    return filter_codes(data, wanted)


# ── 护城河 /api/v1/moat ─────────────────────────────────────
# 旧接口 = 量化层 + 叙述层合并：{ ...量化, narrative: 叙述 }
# 旧行为：不在量化层的 code 直接跳过（不返回）
@router.get("/moat")
def get_moat(codes: str | None = Query(default=None)):
    moat = load_cache("moat", codes, "moat_cache.json")
    llm = load_cache("moat_llm", codes, "moat_llm_cache.json")
    merged = {}
    for code in (parse_codes(codes) or list(moat.keys())):
        if code not in moat:
            continue
        base0 = moat[code]
        base = dict(base0) if isinstance(base0, dict) else base0
        narr = llm.get(code)
        if narr and isinstance(base, dict):
            base["narrative"] = narr
        merged[code] = base
    return {"success": True, "data": normalize(merged)}


# ── 股东人数 /api/v1/shareholders?code=600519（单数 code，非 codes）───
@router.get("/shareholders")
def get_shareholders(code: str = Query(...)):
    entry = cache_store.get_one("shareholder", code)
    if entry is None:
        # 回落到 json 文件（阶段②双读）
        data = read_json(DATA_DIR / "shareholder_cache.json")
        if data is None:
            raise HTTPException(status_code=404, detail="股东数据未缓存，请先运行 scripts/shareholder_data.py")
        entry = data.get(code)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"未找到 {code} 的股东数据")
    return {"success": True, "data": normalize(entry)}


# ── 估值分位 /api/v1/valuation?codes= —— data 是数组（保持传入顺序） ──
@router.get("/valuation")
def get_valuation(codes: str = Query(...)):
    wanted = parse_codes(codes) or []
    rows_map = load_cache("valuation", codes, "valuation_cache.json")
    rows = [normalize(rows_map[c]) for c in wanted if c in rows_map]
    return {"success": True, "data": rows}


# ── 股息率 /api/v1/dividend-yields?codes= —— data 是 dict ──
# 旧接口原样从 data/dividend_yields.json 取，不存在的 code 返回 null（不报错）
@router.get("/dividend-yields")
def get_dividend_yields(codes: str | None = Query(default=None)):
    wanted = parse_codes(codes)
    data = load_cache("dividend_yields", None, "dividend_yields.json")
    if wanted:
        return {"success": True, "data": {c: normalize(data.get(c)) for c in wanted}}
    return {"success": True, "data": normalize(data)}


# ── 波动率 /api/v1/volatility?codes= —— 全量返回（旧接口不按 codes 过滤）──
# 旧响应：{success, generatedAt(ms时间戳), ok(成功数), total, data: items}
# 顶层字段在 PG 里存 cache_meta（原 json 的顶层 meta）
@router.get("/volatility")
def get_volatility():
    data = cache_store.get_many("volatility")
    meta = cache_store.get_meta("volatility")
    if not data:
        cache = read_json(DATA_DIR / "volatility_cache.json")
        if cache is None:
            raise HTTPException(status_code=500, detail="波动率数据生成失败")
        meta = {k: v for k, v in cache.items() if k != "items"}
        data = cache.get("items") or {}
    return {
        "success": True,
        "generatedAt": meta.get("generated_at"),
        "ok": meta.get("ok"),
        "total": meta.get("total"),
        "data": normalize(data),
    }


# ── 汇率 /api/v1/fx —— 读 cache/fx_rate.json（阶段②暂未表化）──
# 旧接口响应：{success, rate, source, date, updatedAt(驼峰), stale}
# 文件原文：{rate, source, date, updated_at(下划线)} → 需要改名
@router.get("/fx")
def get_fx():
    data = read_json(CACHE_DIR / "fx_rate.json")
    if not data or not data.get("rate"):
        raise HTTPException(status_code=503, detail="汇率数据不可用，请等待 fx 缓存生成")
    return {
        "success": True,
        "rate": data["rate"],
        "source": data.get("source", "外部"),
        "date": data["date"],
        "updatedAt": data.get("updated_at"),
        "stale": _fx_stale(data.get("updated_at")),
    }


def _fx_stale(updated_at: str | None) -> bool:
    """和旧 /api/fx 同口径：updated_at 超 48h 判 stale"""
    if not updated_at:
        return True
    from datetime import datetime, timezone
    try:
        age_ms = (datetime.now(timezone.utc).timestamp()
                  - datetime.fromisoformat(updated_at).replace(tzinfo=timezone.utc).timestamp()) * 1000
    except ValueError:
        return True
    return age_ms > 48 * 3600 * 1000


# ── 财务 /api/v1/financials ────────────────────────────────
@router.get("/financials")
def get_financials(codes: str | None = Query(default=None)):
    data = load_cache("financials", codes, "financials_cache.json")
    return {"success": True, "data": normalize(data)}


# ── 恐慌技术 /api/v1/fear-tech ─────────────────────────────
@router.get("/fear-tech")
def get_fear_tech(codes: str | None = Query(default=None)):
    data = load_cache("fear_tech", codes, "fear_tech_cache.json")
    return {"success": True, "data": normalize(data)}


# ── 高管增减持 /api/v1/insider —— 实时抓取留到阶段③ ──────────
@router.get("/insider")
def get_insider(codes: str = Query(...)):
    raise HTTPException(
        status_code=425,
        detail="阶段①未实现实时抓取（旧 /api/insider 带当日缓存，慢）。阶段③迁移后此接口可用。",
    )
