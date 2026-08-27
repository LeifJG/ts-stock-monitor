import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const PORTFOLIO_FILE = path.resolve('/home/lijg/ts-stock-monitor/data/portfolio.json');

// GET: 读取持仓数据
export async function GET() {
  try {
    const data = await fs.readFile(PORTFOLIO_FILE, 'utf-8');
    const positions = JSON.parse(data);
    return NextResponse.json({ success: true, data: positions });
  } catch (error) {
    console.error('读取持仓文件失败:', error);
    return NextResponse.json(
      { success: false, error: '读取持仓文件失败' },
      { status: 500 }
    );
  }
}

// POST: 更新持仓数据
export async function POST(request: Request) {
  try {
    const positions = await request.json();
    await fs.writeFile(PORTFOLIO_FILE, JSON.stringify(positions, null, 2), 'utf-8');
    return NextResponse.json({ success: true, message: '持仓数据已更新' });
  } catch (error) {
    console.error('写入持仓文件失败:', error);
    return NextResponse.json(
      { success: false, error: '写入持仓文件失败' },
      { status: 500 }
    );
  }
}
