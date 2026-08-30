// src/app/api/portfolio/sync/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PORTFOLIO_FILE = path.join(process.cwd(), 'data', 'portfolio.json');

interface Position {
  code: string;
  shares: number;
  cost: number;
  price?: number;
  profit?: number;
  marketValue?: number;
  addedAt?: string;
  note?: string;
  dividends?: Array<{ id: string; date: string; perShare: number; total: number }>;
}

/** 清洗分红记录：字段齐全且金额有效才保留（防坏数据混入服务端持久层）
 *  返回 [] 表示显式清空（用户删除了全部分红），undefined 表示 payload 未携带该字段 */
function cleanDividends(raw: any): Position['dividends'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map((d: any) => ({
      id: String(d?.id || ''),
      date: String(d?.date || ''),
      perShare: parseFloat(d?.perShare) || 0,
      total: parseFloat(d?.total) || 0,
    }))
    .filter((d) => d.date && (d.total > 0 || d.perShare > 0));
  return list;
}

export async function POST(request: Request) {
  try {
    const { data } = await request.json();
    
    if (!Array.isArray(data)) {
      return NextResponse.json({ error: 'data 必须是数组' }, { status: 400 });
    }

    // 读取现有 portfolio
    let portfolio: Position[] = [];
    if (fs.existsSync(PORTFOLIO_FILE)) {
      const raw = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
      portfolio = JSON.parse(raw);
    }

    // 转换并合并数据（兼容 localStorage 标准字段 stockCode/buyPrice 和同步字段 code/cost）
    // 写入前过滤坏数据（无代码/0股/无成本价，如 ETF 残留记录）
    // 分红保留策略（P0-2）：payload 带 dividends 字段 → 覆盖（[] = 显式清空）；
    // 不带字段（如银河粘贴的新持仓）→ 按 code 继承服务端已有分红
    const existingDividends = new Map<string, Position['dividends']>();
    for (const p of portfolio) {
      if (Array.isArray(p.dividends) && p.code) existingDividends.set(p.code, p.dividends);
    }

    const newPositions = data
      .filter((item: any) => {
        const code = String(item?.stockCode || item?.code || "").trim();
        const shares = parseInt(item?.shares) || 0;
        const cost = parseFloat(item?.costPrice || item?.cost || item?.buyPrice) || 0;
        return !!code && shares > 0 && cost > 0;
      })
      .map((item: any) => {
      const code = String(item.stockCode || item.code || '');
      // undefined = payload 未携带 → 继承服务端已有；[] = 显式清空
      const dividends = cleanDividends(item.dividends) ?? existingDividends.get(code);
      return {
        code,
        shares: parseInt(item.shares) || 0,
        cost: parseFloat(item.costPrice || item.cost || item.buyPrice) || 0,
        price: parseFloat(item.currentPrice || item.price) || undefined,
        profit: parseFloat(item.profit) || undefined,
        marketValue: parseFloat(item.marketValue) || undefined,
        addedAt: new Date().toISOString(),
        note: `从银河证券同步 (${new Date().toLocaleDateString('zh-CN')})`,
        // 分红记录随持仓持久化到服务端（P0-2：防浏览器 localStorage 丢失）
        ...(dividends ? { dividends } : {}),
      };
    });

    // 替换整个 portfolio（全量同步模式）
    portfolio = newPositions;

    // 写回文件
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));

    return NextResponse.json({ 
      success: true, 
      count: portfolio.length,
      message: `同步成功：${portfolio.length} 条持仓`
    });
  } catch (error) {
    console.error('Portfolio sync error:', error);
    return NextResponse.json({ error: '同步失败' }, { status: 500 });
  }
}
