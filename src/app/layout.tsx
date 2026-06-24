// ============================================================
// src/app/layout.tsx — 根布局（服务器组件）
// ============================================================

import type { Metadata } from "next";
import "./globals.css";
import AntdProvider from "./AntdProvider";
import { ThemeProvider } from "@/lib/ThemeContext";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 防止 FOUC：在 JS 加载前根据 localStorage 设置 dark class */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const t = localStorage.getItem('ts-stock-monitor:theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.style.colorScheme = 'dark';
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen antialiased" style={{ background: "var(--bg-layout)" }}>
        <ThemeProvider>
          <AntdProvider>{children}</AntdProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
