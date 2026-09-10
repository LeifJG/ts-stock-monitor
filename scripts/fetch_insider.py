#!/usr/bin/env python3
"""
fetch_insider.py — 高管增减持 / 港股回购数据（统一入口）

A股：东财「高管持股变动」stock_ggcg_em（全量快照，覆盖减持/增持，历史到 2004）
港股：东财数据中心 RPT_HK_BUYBACK 报表（逐日回购记录：股数/均价/金额）

用法:
  python3 fetch_insider.py [代码1,代码2,...]          # 全部（A+H，限最近 N$this 条）
输出:
  {"success": true, "data": {
      "insiders": [{code, name, person, changeType, volume(万股), ratio, holdAfter(万股), startDate, endDate, pubDate}],
      "buybacks": [{code, date, volume(万股), avgPrice, amount(万), currency}]
  }}
说明:
  - 高管数据历史很长；默认只回最近 8 条/票，避免前端 tooltip 过载
  - 港股代码（5位 or 纯数字落 data/hk 池）自动走回购接口；A股走雪球/东财增减持
运行：需要 akshare, pandas（项目 .venv）
"""
import os
import re
import sys
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GW = os.popen("ip route show default | awk '{print $3}' | head -1").read().strip()
PROXY = f"http://{GW}:7890"
os.environ.setdefault("HTTP_PROXY", PROXY)
os.environ.setdefault("HTTPS_PROXY", PROXY)
os.environ.setdefault("http_proxy", PROXY)
os.environ.setdefault("https_proxy", PROXY)

MAX_RECORDS = 8  # 每票最多返回条数


def is_hk(code: str) -> bool:
    """港股票判断：纯数字≤5位且命中港股命名规律（源数据多为 finance 接口码）"""
    return len(code) <= 5 and code.isdigit() and (len(code) == 5 or len(code) == 4)


def pad_hk(code: str) -> str:
    """港股码补零到 5 位"""
    return code.zfill(5)


GGCG_CACHE = "/tmp/ts_ggcg_cache.pkl"  # 当日快照缓存（全量拉取约1.7分钟）


def _load_ggcg_df():
    """当日已拉取过则读 pickle，避免 API 路径重复等 2 分钟"""
    import pickle
    import os
    import datetime
    today = datetime.date.today().isoformat()
    if os.path.exists(GGCG_CACHE):
        try:
            meta = pickle.load(open(GGCG_CACHE, "rb"))
            if meta.get("day") == today:
                return meta["df"]
        except Exception:
            pass
    import akshare as ak
    df = ak.stock_ggcg_em("全部")
    try:
        pickle.dump({"day": today, "df": df}, open(GGCG_CACHE, "wb"))
    except Exception:
        pass
    return df


def fetch_a_share_insider(codes: list[str]) -> dict[str, list]:
    """A 股高管增减持：东财 stock_ggcg_em（全量快照，需代理）"""
    out: dict[str, list] = {c: [] for c in codes}
    try:
        df = _load_ggcg_df()
        sub = df[df["代码"].astype(str).isin(codes)]
        sub = sub.sort_values("公告日", ascending=False)
        for code in codes:
            rows = sub[sub["代码"].astype(str) == code].head(MAX_RECORDS)
            for _, r in rows.iterrows():
                def _num(v):
                    try:
                        return None if v != v else round(float(v), 2)
                    except Exception:
                        return None
                out[code].append({
                    "person": str(r.get("股东名称", ""))[:40],
                    "changeType": str(r.get("持股变动信息-增减", "")),
                    "volume": _num(r.get("持股变动信息-变动数量")),          # 万股
                    "ratio": _num(r.get("持股变动信息-占总股本比例")),      # %
                    "holdAfter": _num(r.get("变动后持股情况-持股总数")),    # 万股
                    "startDate": str(r.get("变动开始日", ""))[:10],
                    "endDate": str(r.get("变动截止日", ""))[:10],
                    "pubDate": str(r.get("公告日", ""))[:10],
                })
    except Exception as e:
        print(f"[warn] A股增减持失败: {e}", file=sys.stderr)
    return out


def fetch_hk_buybacks(codes: list[str]) -> dict[str, list]:
    """港股回购记录：东财 RPT_HK_BUYBACK（每日回购报告，需代理）"""
    out: dict[str, list] = {c: [] for c in codes}
    try:
        import urllib.request, json
        for code in codes:
            hk_code = pad_hk(code)
            url = (
                "https://datacenter-web.eastmoney.com/api/data/v1/get?"
                "sortColumns=TRADE_DATE&sortTypes=-1&pageSize=%d&pageNumber=1"
                "&reportName=RPT_HK_BUYBACK&columns=ALL"
                "&filter=(SECURITY_CODE%%3D%%22%s%%22)" % (MAX_RECORDS, hk_code)
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            d = json.loads(urllib.request.urlopen(req, timeout=15).read())
            data = d.get("result", {}).get("data") if d.get("result") else None
            if not data:
                continue
            for r in data:
                avg = r.get("AVG_PRICE")
                out[code].append({
                    "date": str(r.get("TRADE_DATE", ""))[:10],
                    "volume": round(float(r.get("REPO_NUM") or 0) / 1e4, 2),  # 万股
                    "avgPrice": round(float(r.get("AVG_PRICE") or 0), 2),
                    "amount": round(float(r.get("REPO_AMT") or 0) / 1e4, 0),  # 万港元
                    "currency": r.get("CURRENCY", "HKD"),
                    "name": r.get("SECURITY_NAME_ABBR", ""),
                })
    except Exception as e:
        print(f"[warn] 港股回购失败: {e}", file=sys.stderr)
    return out


def main():
    codes_input = sys.argv[1] if len(sys.argv) > 1 else ""
    watch_codes = [c.strip().zfill(5) if (len(c.strip()) <= 5 and not c.strip().startswith(('6', '0', '3'))) else c.strip()
                   for c in codes_input.split(",") if c.strip()]

    hk_codes = [c for c in watch_codes if is_hk(c)]
    a_codes = [c for c in watch_codes if not is_hk(c)]

    insiders = fetch_a_share_insider(a_codes) if a_codes else {}
    buybacks = fetch_hk_buybacks(hk_codes) if hk_codes else {}
    # 港股也可能有增减持（大股东/董监高），但东财 ggcg_em 只覆盖 A 股；港股暂只有回购

    print(json.dumps({
        "success": True,
        "data": {
            "insiders": insiders,
            "buybacks": buybacks,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
