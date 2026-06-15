"use client";

import { useState, useCallback } from "react";

/**
 * 通用 localStorage 持久化 Hook
 * 用法同 useState，但数据自动同步到 localStorage，刷新不丢失。
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // 惰性初始化：从 localStorage 读取，没有则用默认值
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return initialValue;
      return JSON.parse(item) as T;
    } catch {
      return initialValue;
    }
  });

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
