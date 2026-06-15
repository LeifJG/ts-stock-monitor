// ============================================================
// src/app/layout.tsx — 根布局
// ============================================================
// 设置页面标题、描述和全局样式，使用 zh-CN 语言标识。

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "📊 A 股量化看板",
  description: "A股实时行情 · 基本面 · 智能预警",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 antialiased">{children}</body>
    </html>
  );
}
