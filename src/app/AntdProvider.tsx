"use client";

import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";

// ─── Vercel 风格设计令牌 ─────────────────────────────────────
// 配色：纯白画布 + #171717 文字 + shadow-as-border
// 字体：Geist（通过 next/font/google 加载）
// 圆角：6px 标准，8px 卡片，9999px 标签

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          // ── 颜色 ──
          colorPrimary: "#171717",          // Vercel Black
          colorSuccess: "#16a34a",
          colorWarning: "#eab308",
          colorError: "#ef4444",
          colorInfo: "#0070f3",

          colorBgBase: "#ffffff",
          colorBgContainer: "#ffffff",
          colorBgElevated: "#ffffff",
          colorBgLayout: "#fafafa",

          colorTextBase: "#171717",
          colorTextSecondary: "#4d4d4d",
          colorTextTertiary: "#808080",
          colorTextQuaternary: "#bfbfbf",

          colorBorder: "rgba(0,0,0,0.08)",  // Vercel shadow-border
          colorBorderSecondary: "rgba(0,0,0,0.06)",

          // ── 字体 ──
          fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontFamilyCode: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', monospace",

          // ── 圆角 ──
          borderRadius: 6,
          borderRadiusLG: 8,
          borderRadiusSM: 4,

          // ── 间距 ──
          paddingXXS: 4,
          paddingXS: 8,
          paddingSM: 12,
          padding: 16,
          paddingMD: 16,
          paddingLG: 20,
          paddingXL: 24,

          // ── 阴影 ──
          boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04)",
          boxShadowSecondary: "0px 0px 0px 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 8px -8px rgba(0,0,0,0.04)",
          boxShadowTertiary: "0px 0px 0px 1px rgba(0,0,0,0.08), 0px 4px 6px -2px rgba(0,0,0,0.04)",

          // ── 其他 ──
          fontSize: 14,
          fontSizeSM: 12,
          fontSizeLG: 16,
          lineHeight: 1.5,
          controlHeight: 32,
          controlHeightSM: 28,
        },
        components: {
          Card: {
            colorBorderSecondary: "rgba(0,0,0,0.06)",
            paddingSM: 14,
          },
          Table: {
            headerBg: "#fafafa",
            headerColor: "#808080",
            headerSortHoverBg: "#f3f4f6",
            borderColor: "rgba(0,0,0,0.06)",
            rowHoverBg: "#fafafa",
          },
          Tag: {
            defaultBg: "#f5f5f5",
            defaultColor: "#4d4d4d",
          },
          Progress: {
            defaultColor: "#e5e7eb",
            remainingColor: "#f3f4f6",
          },
          Button: {
            primaryShadow: "none",
            textHoverBg: "#f5f5f5",
          },
          Input: {
            activeShadow: "0px 0px 0px 2px rgba(0,0,0,0.06)",
            addonBg: "#fafafa",
          },
          Select: {
            optionSelectedBg: "#f5f5f5",
          },
          Switch: {
            trackHeight: 22,
            handleSize: 18,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
