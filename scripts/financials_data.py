#!/usr/bin/env python3
"""
financials_data.py — 深度财务指标数据模块

从 akshare 获取财务分析数据，计算：
  - 毛利率（Gross Margin）及趋势
  - 经营现金流/净利润比率（OCF/Net Profit）
缓存到 data/financials_cache.json，供 stock-api.ts 读取
"""

import os, json, sys
from pathlib import Path

os.environ["HTTP_PROXY"] = "http://192.168.124.11:7890"
os.environ["HTTPS_PROXY"] = "http://192.168.124.11:7890"
import akshare as ak

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "financials_cache.json"


def fetch_all(codes: list[str]) -> dict:
    """批量获取财务数据"""
    result = {}

    for code in codes:
        try:
            df = ak.stock_financial_analysis_indicator(symbol=code, start_year="2020")
            if df.empty:
                continue

            # 年度报告
            mask = df["日期"].astype(str).str.contains("12-31")
            annual = df[mask].tail(3)

            # 匹配列名（编码可能有差异）
            gm_col = next((c for c in df.columns if "销售毛利" in c), None)
            cr_col = next((c for c in df.columns if "主营业务成本" in c), None)
            cf_col = next((c for c in df.columns if "经营现金净流量与净利润" in c), None)

            gross_margins = []
            ocf_to_np_list = []

            for _, row in annual.iterrows():
                # 毛利率
                gm = row.get(gm_col) if gm_col else None
                if (gm is None or str(gm) in ("nan", "None", "")) and cr_col:
                    cr = row.get(cr_col)
                    if cr is not None and str(cr) not in ("nan", "None", ""):
                        gm = round(100.0 - float(cr), 2)
                if gm is not None and str(gm) not in ("nan", "None", ""):
                    gross_margins.append(round(float(gm), 1))

                # OCF/Net Profit
                cf = row.get(cf_col) if cf_col else None
                if cf is not None and str(cf) not in ("nan", "None", ""):
                    ocf_to_np_list.append(round(float(cf), 2))

            # 毛利率趋势
            trend = 0
            if len(gross_margins) >= 2:
                old, new = gross_margins[0], gross_margins[-1]
                if new > old + 1.0:
                    trend = 1
                elif new < old - 1.0:
                    trend = -1

            entry = {}
            if gross_margins:
                entry["grossMargin"] = gross_margins[-1]
            if trend != 0:
                entry["grossMarginTrend"] = trend
            if ocf_to_np_list:
                entry["ocfToNetProfit"] = ocf_to_np_list[-1]

            if entry:
                result[code] = entry

        except Exception as e:
            print(f"[warn] {code}: {e}", file=sys.stderr)

    return result


def main():
    codes = sys.argv[1:] if len(sys.argv) > 1 else []

    if not codes:
        div_file = Path(__file__).resolve().parent.parent / "data" / "dividend_yields.json"
        if div_file.exists():
            try:
                all_data = json.loads(div_file.read_text())
                codes = list(all_data.keys())
            except Exception:
                codes = []
        if not codes:
            codes = ["600519", "000858", "600036", "601318", "000333", "600900", "000651"]

    data = fetch_all(codes)

    # 合并现有缓存
    old = {}
    if CACHE_FILE.exists():
        try:
            old = json.loads(CACHE_FILE.read_text())
        except Exception:
            pass
    old.update(data)

    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(old, ensure_ascii=False, indent=2))
    print(f"✅ financials_cache.json updated: {len(data)} stocks")


if __name__ == "__main__":
    main()
