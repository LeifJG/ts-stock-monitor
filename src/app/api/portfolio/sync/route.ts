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

    // 转换并合并数据
    const newPositions = data.map((item: any) => ({
      code: String(item.stockCode || item.code || ''),
      shares: parseInt(item.shares) || 0,
      cost: parseFloat(item.costPrice || item.cost) || 0,
      price: parseFloat(item.currentPrice || item.price) || undefined,
      profit: parseFloat(item.profit) || undefined,
      marketValue: parseFloat(item.marketValue) || undefined,
      addedAt: new Date().toISOString(),
      note: `从银河证券同步 (${new Date().toLocaleDateString('zh-CN')})`
    }));

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
