// ============================================================
// AntdProvider.tsx — Ant Design 主题配置（浅色 + 深色）
// ============================================================

"use client";

import { ConfigProvider, theme as antTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useTheme } from "@/lib/ThemeContext";

// ─── 浅色主题令牌（Vercel 风格） ───────────────────────────
const LIGHT_TOKENS: Record<string, any> = {
  // ── 颜色 ──
  colorPrimary: "#171717",
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

  colorBorder: "rgba(0,0,0,0.08)",
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
  boxShadowSecondary:
    "0px 0px 0px 1px rgba(0,0,0,0.08), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 8px -8px rgba(0,0,0,0.04)",
  boxShadowTertiary: "0px 0px 0px 1px rgba(0,0,0,0.08), 0px 4px 6px -2px rgba(0,0,0,0.04)",

  // ── 其他 ──
  fontSize: 14,
  fontSizeSM: 12,
  fontSizeLG: 16,
  lineHeight: 1.5,
  controlHeight: 32,
  controlHeightSM: 28,
};

const LIGHT_COMPONENTS: Record<string, any> = {
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
};

// ─── 深色主题令牌（Vercel Dark 风格） ──────────────────────
const DARK_TOKENS: Record<string, any> = {
  colorPrimary: "#e5e5e5",
  colorSuccess: "#22c55e",
  colorWarning: "#eab308",
  colorError: "#ef4444",
  colorInfo: "#3b82f6",

  colorBgBase: "#0a0a0a",
  colorBgContainer: "#18181b",
  colorBgElevated: "#1f1f23",
  colorBgLayout: "#09090b",

  colorTextBase: "#fafafa",
  colorTextSecondary: "#a1a1aa",
  colorTextTertiary: "#71717a",
  colorTextQuaternary: "#52525b",

  colorBorder: "rgba(255,255,255,0.08)",
  colorBorderSecondary: "rgba(255,255,255,0.06)",

  fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyCode: "var(--font-geist-mono), ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', monospace",

  borderRadius: 6,
  borderRadiusLG: 8,
  borderRadiusSM: 4,

  paddingXXS: 4,
  paddingXS: 8,
  paddingSM: 12,
  padding: 16,
  paddingMD: 16,
  paddingLG: 20,
  paddingXL: 24,

  boxShadow: "0px 0px 0px 1px rgba(255,255,255,0.08), 0px 2px 2px rgba(0,0,0,0.4)",
  boxShadowSecondary:
    "0px 0px 0px 1px rgba(255,255,255,0.08), 0px 2px 2px rgba(0,0,0,0.4), 0px 8px 8px -8px rgba(0,0,0,0.6)",
  boxShadowTertiary: "0px 0px 0px 1px rgba(255,255,255,0.08), 0px 4px 6px -2px rgba(0,0,0,0.4)",

  fontSize: 14,
  fontSizeSM: 12,
  fontSizeLG: 16,
  lineHeight: 1.5,
  controlHeight: 32,
  controlHeightSM: 28,
};

const DARK_COMPONENTS: Record<string, any> = {
  Card: {
    colorBorderSecondary: "rgba(255,255,255,0.06)",
    paddingSM: 14,
  },
  Table: {
    headerBg: "#1a1a1e",
    headerColor: "#a1a1aa",
    headerSortHoverBg: "#27272a",
    borderColor: "rgba(255,255,255,0.06)",
    rowHoverBg: "#1f1f23",
  },
  Tag: {
    defaultBg: "#27272a",
    defaultColor: "#d4d4d8",
  },
  Progress: {
    defaultColor: "#3f3f46",
    remainingColor: "#27272a",
  },
  Button: {
    primaryShadow: "none",
    textHoverBg: "#27272a",
  },
  Input: {
    activeShadow: "0px 0px 0px 2px rgba(255,255,255,0.06)",
    addonBg: "#1a1a1e",
  },
  Select: {
    optionSelectedBg: "#27272a",
  },
  Switch: {
    trackHeight: 22,
    handleSize: 18,
  },
};

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: isDark ? DARK_TOKENS : LIGHT_TOKENS,
        components: isDark ? DARK_COMPONENTS : LIGHT_COMPONENTS,
      }}
    >
      {children}
    </ConfigProvider>
  );
}
