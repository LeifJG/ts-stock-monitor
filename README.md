# 📊 A 股量化看板

一个基于 **Next.js 16 + TypeScript + Tailwind CSS** 的 A 股实时行情看板，支持基本面指标展示和智能预警。

## 功能特性

- **实时行情** — 对接新浪财经 API，获取 A 股实时股价、涨跌幅、成交量
- **基本面指标** — 对接东方财富 API，展示市盈率、市净率、总市值、股息率
- **智能预警** — 自定义告警规则（如股息率 > 5%、涨跌幅 > 9.8%），自动判断触发
- **自选股管理** — 自由添加/删除股票代码，支持多只同时监控
- **定时刷新** — 5/10/30/60 秒自动刷新，也可手动刷新
- **视觉区分** — 涨红跌绿，触发告警的卡片高亮标记

## 快速开始

```bash
# 克隆项目
git clone https://github.com/LeifJG/ts-stock-monitor.git
cd ts-stock-monitor

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器打开 http://localhost:3000 即可使用。

## 使用说明

1. **添加自选股** — 在顶部输入框输入 6 位股票代码（如 `600519`），点击"添加"
2. **设置预警** — 点击右上角"预警规则"按钮，添加自定义规则
3. **调整刷新频率** — 通过刷新控制栏选择自动刷新间隔
4. **查看行情** — 卡片展示每只股票的实时价格、涨跌幅和基本面指标

### 内置默认自选股

| 代码 | 名称 |
|------|------|
| 600519 | 贵州茅台 |
| 000858 | 五粮液 |
| 600036 | 招商银行 |
| 601318 | 中国平安 |
| 000333 | 美的集团 |

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **数据源**: 新浪财经 API（实时行情）、东方财富 API（基本面）

## 项目结构

```
src/
├── app/
│   ├── api/stocks/route.ts   # 后端 API 路由（代理外部数据源）
│   ├── globals.css            # 全局样式
│   ├── layout.tsx             # 根布局
│   └── page.tsx               # 主页面（组装所有组件）
├── components/
│   ├── AlertRuleForm.tsx      # 添加告警规则表单
│   ├── AlertRuleList.tsx      # 告警规则列表
│   ├── RefreshTimer.tsx       # 自动刷新控制栏
│   ├── StockCard.tsx          # 单只股票行情卡片
│   └── StockList.tsx          # 股票卡片列表容器
├── hooks/
│   ├── useAlerts.ts           # 告警规则管理 Hook
│   └── useStockData.ts        # 股票数据获取 Hook
└── lib/
    ├── alert-engine.ts        # 告警规则引擎（纯函数）
    ├── constants.ts           # 全局常量与默认配置
    ├── stock-api.ts           # 数据获取模块（新浪/东方财富适配）
    └── types.ts               # 共享类型定义
```

## 数据来源

- 实时行情：新浪财经 `https://hq.sinajs.cn/`
- 基本面数据：东方财富 `https://push2.eastmoney.com/`

所有数据通过服务端 API 路由代理，前端不直接调用外部接口。
