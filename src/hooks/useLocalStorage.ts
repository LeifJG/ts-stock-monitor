"use client";

import { useState, useCallback, useEffect } from "react";

/**
 * 通用 localStorage 持久化 Hook
 * 用法同 useState，但数据自动同步到 localStorage，刷新不丢失。
 *
 * ⚠️ hydration 安全：首渲染固定用 initialValue（与 SSR 输出一致），
 * mount 后再从 localStorage 读真实值。若首渲染就读 localStorage，
 * 会导致 React hydration mismatch（#418）→ 事件树与 DOM 脱节，
 * 表现为「state 更新了但界面不刷新」。
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // 首渲染固定 initialValue，保证与服务端 HTML 一致
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // mount 后再读 localStorage 真实值（一次性同步）
  useEffect(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return;
      const parsed = JSON.parse(item) as T;
      // 与 initialValue 深比较，相同则跳过（避免多余渲染/refetch）
      if (JSON.stringify(parsed) !== JSON.stringify(initialValue)) {
        setStoredValue(parsed);
      }
    } catch {
      // localStorage 不可用或解析失败：保持 initialValue
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 写入时同时更新 state 和 localStorage
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const next = value instanceof Function ? value(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // localStorage 不可用或配额超限时静默失败
        }
        return next;
      });
    },
    [key]
  );

  return [storedValue, setValue];
}
