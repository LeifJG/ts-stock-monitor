// next.config.ts — ts-stock-monitor 配置
import type { NextConfig } from "next";

const config: NextConfig = {
  // 允许从 WSL IP 访问 dev 资源（JS/CSS/WebSocket）
  allowedDevOrigins: ["172.28.248.8"],

  // ── 前后端分离过渡期转发（阶段③-b）──────────────────────────
  // 前端调 /api/v1/xxx → 服务端转发到 FastAPI:8000。
  // 为什么走 Next 服务端转发而不是浏览器直连 8000：
  //   1. 浏览器直连要处理 CORS；服务端发起同源，无跨域问题
  //   2. Clash 会接管 Windows→WSL 的 localhost 转发，服务端 127.0.0.1 调用最稳
  // 灰度切某个接口时把它从 /api 目录删掉即可：rewrites 优先级低于真实路由。
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
};

export default config;
