# ============================================================
# backend/app/routers/read_api.py — 阶段①：只读 API 镜像路由
# ============================================================
# 原则：响应 JSON 必须和旧 Next 接口「逐字段一致」，
# 前端切换只改 NEXT_PUBLIC_API_BASE 不用动任何业务代码。
# FastAPI 写法速记（对前端）：
#   @router.get("/xxx")   ≈ app/api/xxx/route.ts 的 export async function GET
#   Query(default=None)   ≈ request.nextUrl.searchParams.get()
#   返回 dict             ≈ NextResponse.json(...)（FastAPI 自动序列化）
#
# ⚠ 数值精度坑（2026-09-13 踩过）：TS 的 JSON.stringify(77.0) 输出 77，
#   Python 的 json.dumps(77.0) 输出 77.0——镜像层要过 normalize()：
#   float 且整值 → int，保证和旧接口逐字段一致。

from fastapi import APIRouter, HTTPException, Query

from ..config import CACHE_DIR, DATA_DIR, filter_codes, parse_codes, read_json

router = APIRouter()


def normalize(obj):
    """递归把「值为整数的 float」转回 int，对齐 JS 的序列化行为"""
    if isinstance(obj, dict):
        return {k: normalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize(v) for v in obj]
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    return obj


def _mirror(cache_file: str, codes: str | None):
    """镜像通用模板：读 json → normalize → 按 codes 过滤"""
    data = read_json(DATA_DIR / cache_file)
    if data is None:
        data = {}
    return normalize(filter_codes(data, parse_codes(codes)))


# ── 护城河 /api/v1/moat ─────────────────────────────────────
# 旧接口 = 量化层 moat_cache.json + 叙述层 moat_llm_cache.json 合并：
# { ...量化, narrative: 叙述 }（叙述缺失时没有 narrative 字段）
@router.get("/moat")
def get_moat(codes: str | None = Query(default=None)):
    moat = read_json(DATA_DIR / "moat_cache.json") or {}
    llm = read_json(DATA_DIR / "moat_llm_cache.json") or {}
    wanted = parse_codes(codes) or list(moat.keys())
    merged = {}
    for code in wanted:
        if code not in moat:
            continue
        base = dict(moat[code])
        narr = llm.get(code)
        if narr:
            base["narrative"] = narr
        merged[code] = base
    return {"success": True, "data": normalize(merged)}


# ── 股东人数 /api/v1/shareholders?code=600519（单数 code，非 codes）───
# 旧接口响应 {success, data:{code, latestHolders, latestChangePct, trend:[]}}
@router.get("/shareholders")
def get_shareholders(code: str = Query(...)):
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
    raw = read_json(DATA_DIR / "valuation_cache.json")
    if raw is None:
        raw = {}
    rows = [normalize(raw[c]) for c in (parse_codes(codes) or []) if c in raw]
    return {"success": True, "data": rows}


# ── 股息率 /api/v1/dividend-yields?codes= —— data 是 dict ──
# 旧接口原样从 data/dividend_yields.json 取，不存在的 code 返回 null（不报错）
@router.get("/dividend-yields")
def get_dividend_yields(codes: str | None = Query(default=None)):
    data = read_json(DATA_DIR / "dividend_yields.json") or {}
    wanted = parse_codes(codes)
    if wanted:
        rows = {c: normalize(data.get(c)) for c in wanted}
    else:
        rows = normalize(data)
    return {"success": True, "data": rows}


# ── 波动率 /api/v1/volatility?codes= —— 全量返回（旧接口不按 codes 过滤）──
# 旧响应：{success, generatedAt(ms时间戳), ok(成功数), total, data: items}
# 旧实现还有「当日缓存否则现算」逻辑——阶段①只镜像读缓存部分（欧洲期权思路，
# 定时刷新留在阶段④），缓存非当日时原样返回（stale 兜底和旧接口一致）。
@router.get("/volatility")
def get_volatility():
    cache = read_json(DATA_DIR / "volatility_cache.json")
    if cache is None:
        raise HTTPException(status_code=500, detail="波动率数据生成失败")
    return {
        "success": True,
        "generatedAt": cache.get("generated_at"),
        "ok": cache.get("ok"),
        "total": cache.get("total"),
        "data": normalize(cache.get("items") or {}),
    }


# ── 汇率 /api/v1/fx —— 读 cache/fx_rate.json，注意字段名转换 ──
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
        # stale 逻辑对齐旧接口：updated_at 距今超过 48h = 过期
        "stale": _fx_stale(data.get("updated_at")),
    }


def _fx_stale(updated_at: str | None) -> bool:
    """和旧 /api/fx 同口径：updated_at 超 48h 判 stale"""
    if not updated_at:
        return True
    from datetime import datetime, timezone, timedelta
    try:
        age_ms = datetime.now(timezone.utc).timestamp() * 1000 - datetime.fromisoformat(updated_at).replace(tzinfo=timezone.utc).timestamp() * 1000
    except ValueError:
        return True
    return age_ms > 48 * 3600 * 1000


# ── 高管增减持 /api/v1/insider —— 实时抓取留到阶段② ────────────
@router.get("/insider")
def get_insider(codes: str = Query(...)):
    raise HTTPException(
        status_code=425,
        detail="阶段①未实现实时抓取（旧 /api/insider 带当日缓存，慢）。阶段②迁移后此接口可用。",
    )
