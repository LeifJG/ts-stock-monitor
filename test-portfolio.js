// 测试组合收益计算逻辑
const portfolioData = [
  { code: "000333", shares: 300, cost: 50.932, price: 86.18 },
  { code: "01810", shares: 4400, cost: 38.497, price: 27.48 },
  { code: "09880", shares: 1250, cost: 123.107, price: 82.95 },
  { code: "09988", shares: 1500, cost: 136.846, price: 115.5 },
  { code: "09992", shares: 200, cost: 153.709, price: 154 },
  { code: "600036", shares: 1300, cost: 31.135, price: 39.58 },
  { code: "600900", shares: 500, cost: 18.459, price: 28.1 },
  { code: "600941", shares: 200, cost: 85.29, price: 98.04 }
];

const HKD_TO_CNY = 0.92;

function isHKStock(code) {
  return /^\d{5}$/.test(code);
}

function getExchangeRate(code) {
  return isHKStock(code) ? HKD_TO_CNY : 1;
}

let totalInvested = 0;
let totalMarketValue = 0;

console.log("=== 组合收益计算测试 ===\n");

for (const pos of portfolioData) {
  const exchangeRate = getExchangeRate(pos.code);
  const invested = pos.cost * pos.shares * exchangeRate;
  const marketValue = pos.price * pos.shares * exchangeRate;
  const profit = marketValue - invested;
  
  totalInvested += invested;
  totalMarketValue += marketValue;
  
  console.log(`${pos.code} (${isHKStock(pos.code) ? '港股' : 'A股'}):`);
  console.log(`  投入: ${pos.cost} × ${pos.shares} × ${exchangeRate} = ${invested.toFixed(2)}`);
  console.log(`  市值: ${pos.price} × ${pos.shares} × ${exchangeRate} = ${marketValue.toFixed(2)}`);
  console.log(`  盈亏: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`);
  console.log();
}

const totalProfit = totalMarketValue - totalInvested;
const profitPct = (totalProfit / totalInvested * 100);

console.log("=== 汇总 ===");
console.log(`总投入: ¥${totalInvested.toFixed(2)}`);
console.log(`总市值: ¥${totalMarketValue.toFixed(2)}`);
console.log(`总盈亏: ${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)}`);
console.log(`收益率: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%`);
