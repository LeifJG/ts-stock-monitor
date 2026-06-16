// ============================================================
// src/app/layout.tsx — 根布局
// ============================================================

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AntdProvider from "./AntdProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased" style={{ background: "#fafafa" }}>
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
