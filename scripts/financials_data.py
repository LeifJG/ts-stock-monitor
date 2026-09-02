#!/usr/bin/env python3
"""
financials_data.py — 深度财务指标数据模块

从 akshare 获取财务分析数据，计算：
  - 毛利率（Gross Margin）及趋势
  - 经营现金流/净利润比率（OCF/Net Profit）
  - 资产负债率（Debt Ratio）
  - 投入资本回报率（ROIC）
缓存到 data/financials_cache.json，供 stock-api.ts 读取
"""

import os, json, sys, re, time
from pathlib import Path

from net_utils import setup_proxy_env

setup_proxy_env()
import akshare as ak

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "financials_cache.json"

HK_CODE_RE = re.compile(r"^\d{5}$")  # 港股 5 位码


def _is_hk(code: str) -> bool:
    return bool(HK_CODE_RE.match(code))


def fetch_one_hk(code: str) -> dict | None:
    """港股财务指标：东财 HKF10 主要指标（年报），DNS 抖动重试+退避。

    字段映射（与 A 股缓存同构）：
      grossMargin = GROSS_PROFIT_RATIO（毛利率%）
      roic = ROIC_YEARLY（年度 ROIC%）
      debtRatio = DEBT_ASSET_RATIO（资产负债率%）
      ocfToNetProfit = PER_NETCASH_OPERATE / EPS_TTM（每股经营现金流/每股收益 ≈ 现金流/净利比）
    """
    df = None
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            df = ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="年度")
            break
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    if df is None or df is not None and getattr(df, "empty", True):
        if last_err:
            print(f"[warn] {code}: 港股财务接口重试 3 次仍失败: {last_err}", file=sys.stderr)
        return None
    if df is None or df.empty:
        return None

    try:
        df = df.sort_values("REPORT_DATE").reset_index(drop=True)
        # 最近 3 期年报的毛利率序列（算趋势）
        gm_list: list[float] = []
        for _, row in df.tail(3).iterrows():
            v = row.get("GROSS_PROFIT_RATIO")
            if v is not None and str(v) not in ("nan", "None", ""):
                gm_list.append(round(float(v), 1))

        latest = df.iloc[-1]

        def _num(col: str) -> float | None:
            v = latest.get(col)
            if v is None or str(v) in ("nan", "None", ""):
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        entry: dict = {}
        if gm_list:
            entry["grossMargin"] = gm_list[-1]
            if len(gm_list) >= 2:
                old, new = gm_list[0], gm_list[-1]
                if new > old + 1.0:
                    entry["grossMarginTrend"] = 1
                elif new < old - 1.0:
                    entry["grossMarginTrend"] = -1

        dr = _num("DEBT_ASSET_RATIO")
        if dr is not None and 0 < dr < 100:
            entry["debtRatio"] = round(dr, 1)

        roic = _num("ROIC_YEARLY")
        if roic is not None and -50 < roic < 100:
            entry["roic"] = round(roic, 1)

        # OCF/净利：每股经营现金流 / 每股收益（EPS_TTM <=0 时无意义，置空）
        per_ocf = _num("PER_NETCASH_OPERATE")
        eps = _num("EPS_TTM")
        if per_ocf is not None and eps is not None and eps > 0:
            entry["ocfToNetProfit"] = round(per_ocf / eps, 2)

        return entry if entry else None
    except Exception as e:
        print(f"[warn] {code}: 港股财务解析失败: {e}", file=sys.stderr)
        return None


def fetch_all(codes: list[str]) -> dict:
    """批量获取财务数据（A股走新浪分析指标，港股走东财 HKF10）"""
    result = {}

    for code in codes:
        if _is_hk(code):
            entry = fetch_one_hk(code)
            if entry:
                result[code] = entry
            continue
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
            dr_col = next((c for c in df.columns if "资产负债率" in c), None)

            gross_margins = []
            ocf_to_np_list = []
            debt_ratios = []

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

                # 资产负债率
                dr = row.get(dr_col) if dr_col else None
                if dr is not None and str(dr) not in ("nan", "None", ""):
                    debt_ratios.append(round(float(dr), 1))

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
            if debt_ratios:
                entry["debtRatio"] = debt_ratios[-1]

            if entry:
                result[code] = entry

        except Exception as e:
            print(f"[warn] {code}: {e}", file=sys.stderr)

        # ROIC 需要从 stock_financial_abstract 单独获取（有投入资本回报率列）
        try:
            df2 = ak.stock_financial_abstract(symbol=code)
            # df2 格式: 指标为行，日期为列
            for _, row in df2.iterrows():
                indicator = str(row["指标"]).strip()
                if "投入资本回报率" in indicator:
                    # 找最新有值的年报（列名如 20241231 或 2024-12-31）
                    for col in reversed(df2.columns):
                        col_str = str(col)
                        if "1231" in col_str or "12-31" in col_str:
                            val = row.get(col)
                            if val is not None and str(val) not in ("nan", "None", ""):
                                if code not in result:
                                    result[code] = {}
                                result[code]["roic"] = round(float(val), 1)
                                break
                    break
        except Exception as e:
            print(f"[warn] {code} ROIC: {e}", file=sys.stderr)

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
        # 并入当前持仓（港股持仓经 fetch_one_hk 覆盖，保证持仓股财务指标齐全）
        pf_file = Path(__file__).resolve().parent.parent / "data" / "portfolio.json"
        if pf_file.exists():
            try:
                pf = json.loads(pf_file.read_text())
                pf_list = pf if isinstance(pf, list) else (pf.get("positions") or pf.get("data") or [])
                for item in pf_list:
                    c = str(item.get("stockCode") or item.get("code") or "").strip()
                    if c and c not in codes:
                        codes.append(c)
            except Exception:
                pass

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
