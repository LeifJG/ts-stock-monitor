// ============================================================
// src/lib/api-endpoints.ts — 接口地址的唯一出口（灰度切换开关）
// ------------------------------------------------------------
// 为什么要有这个文件：前后端分离期间同一份接口存在两套实现
//   · Next.js 自带：/api/portfolio、/api/portfolio/sync
//   · FastAPI 后端：/api/v1/portfolio、/api/v1/portfolio/sync
// 如果各处直接写死字符串，切灰度就得满地改。集中到这里，
// 改一个环境变量就能整体切走，回滚也只是把变量去掉。
//
// 灰度用法（.env.local）：
//   NEXT_PUBLIC_PORTFOLIO_API=v1     # 持仓读写走后端
//   （不写或写成 next）= 完全走原来的 Next 接口，行为与之前一致
//
// 回滚：删掉该行 → pnpm build → systemctl --user restart ts-stock-monitor
//
// ⚠ NEXT_PUBLIC_ 前缀的变量在构建时被内联进产物，
//    改了必须重新 build 才生效（运行时改无效）。

const USE_BACKEND_PORTFOLIO = process.env.NEXT_PUBLIC_PORTFOLIO_API === "v1";

/** 持仓列表（GET 读 / POST 整体覆盖） */
export const PORTFOLIO_ENDPOINT = USE_BACKEND_PORTFOLIO
  ? "/api/v1/portfolio"
  : "/api/portfolio";

/** 持仓同步（POST { data: [...] }，分红继承 + 补仓字段透传） */
export const PORTFOLIO_SYNC_ENDPOINT = USE_BACKEND_PORTFOLIO
  ? "/api/v1/portfolio/sync"
  : "/api/portfolio/sync";

/** 当前持仓接口走哪一侧，调试/排查时打印用 */
export const PORTFOLIO_API_SIDE: "backend" | "next" = USE_BACKEND_PORTFOLIO
  ? "backend"
  : "next";
