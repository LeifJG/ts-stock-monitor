// next.config.ts — ts-stock-monitor 配置
import type { NextConfig } from "next";

const config: NextConfig = {
  // 允许从 WSL IP 访问 dev 资源（JS/CSS/WebSocket）
  allowedDevOrigins: ["172.28.248.8"],
};

export default config;
