// ============================================================
// ThemeContext.tsx — 深色/浅色主题上下文
// ============================================================

"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  isDark: false,
});

const STORAGE_KEY = "ts-stock-monitor:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // 初始化：从 localStorage 读取，或跟随系统偏好
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "dark" || stored === "light") {
        setTheme(stored);
      } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } catch {}
    setMounted(true);
  }, []);

  // 切换时写入 localStorage + 更新 html class
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
    document.documentElement.classList.toggle("dark", theme === "dark");
    // 也设置 color-scheme meta
    document.documentElement.style.colorScheme = theme;
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  // 防止 SSR 闪烁：不匹配的 theme 会导致 hydrate 不一致
  // 在 mounted 之前返回 light（服务端统一用 light）
  if (!mounted) {
    return (
      <ThemeContext.Provider value={{ theme: "light", toggleTheme, isDark: false }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
