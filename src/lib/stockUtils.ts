// ============================================================
// stockUtils.ts — 股票相关工具函数
// ============================================================

/** 港币转人民币汇率 */
export const HKD_TO_CNY = 0.86;

/**
 * 判断是否是港股
 * 港股代码格式：5位数字，以 0 开头（如 01810, 09880, 00700）
 * 注意：A股代码是6位数字（如 600036, 000333）
 */
export function isHKStock(code: string): boolean {
  return /^\d{5}$/.test(code);
}

/**
 * 获取汇率乘数（港股返回 HKD_TO_CNY，A股返回 1）
 */
export function getExchangeRate(code: string): number {
  return isHKStock(code) ? HKD_TO_CNY : 1;
}

/**
 * 计算市值（自动处理汇率转换）
 */
export function calcMarketValue(code: string, shares: number, price: number): number {
  return shares * price * getExchangeRate(code);
}
