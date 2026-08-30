// ============================================================
// stockUtils.ts — 股票相关工具函数
// ============================================================

/** 港币转人民币汇率（P1-5：默认回退值；运行时由 fetch_fx_rate.py 抓取的中行牌价注入） */
export const HKD_TO_CNY = 0.86;

// 运行时汇率（进程/页面级缓存），setHkdRate() 注入后生效
let _hkdRate = HKD_TO_CNY;

/** 注入实时港币汇率（合理区间校验，防脏数据） */
export function setHkdRate(rate: number): boolean {
  if (Number.isFinite(rate) && rate >= 0.75 && rate <= 0.98) {
    _hkdRate = rate;
    return true;
  }
  return false;
}

/** 当前生效的港币汇率（调试/展示用） */
export function getHkdRate(): number {
  return _hkdRate;
}

/**
 * 判断是否是港股
 * 港股代码格式：5位数字，以 0 开头（如 01810, 09880, 00700）
 * 注意：A股代码是6位数字（如 600036, 000333）
 */
export function isHKStock(code: string): boolean {
  return /^\d{5}$/.test(code);
}

/**
 * 获取汇率乘数（港股返回实时 HKD 汇率，A股返回 1）
 */
export function getExchangeRate(code: string): number {
  return isHKStock(code) ? _hkdRate : 1;
}

/**
 * 计算市值（自动处理汇率转换）
 */
export function calcMarketValue(code: string, shares: number, price: number): number {
  return shares * price * getExchangeRate(code);
}
