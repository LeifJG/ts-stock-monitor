// ============================================================
// src/lib/api-cache.ts — 接口响应缓存（TTL + 并发合并 + 陈旧回退）
// ------------------------------------------------------------
// 为什么需要：上游行情源（腾讯 qt.gtimg.cn:443）的 TCP 建连会
// 间歇性卡死 7 秒（实测 time_connect 就占 7.26s），Node 无超时保护时
// 一次请求要等满 5s 才回退代理，页面就是「转圈 5 秒」。
// 外部源不可控，所以本地扛：同样的 key 在 TTL 内直接返缓存。
//
// 三个关键行为：
//   1. TTL 内命中 → 立刻返回（毫秒级）
//   2. 缓存已过期但未超 staleTTL → 立刻返回旧数据，后台异步刷新
//      （宁可给 20 秒前的价格，也不要让用户盯着转圈）
//   3. 同一 key 的并发请求合并成一次上游调用，避免同时打开多张请求
//
// 局限：进程内内存缓存，重启即失效；多实例部署需要换 Redis。
// ============================================================

import * as fs from "fs";
import * as path from "path";

interface Entry<T> {
  data: T;
  ts: number;      // 写入时间
  loading: boolean; // 是否正在后台刷新
}

export interface CacheOptions {
  /** 新鲜期（毫秒）：这段时间内直接返回不刷新 */
  ttl: number;
  /**
   * 最大可接受年龄（毫秒，默认 24 小时）。
   * 只要没超过这个年龄，就永远先返回旧数据 + 后台刷新，绝不让用户等。
   * 超过则同步加载（等价于冷启动，只会在进程刚起或缓存实在太久时发生）。
   */
  maxAge?: number;
  /** @deprecated 旧参数，等价于 maxAge，保留兼容 */
  staleTtl?: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** 交易时段判定（A 股 9:15–15:05，周一至周五），用于选不同 TTL */
export function isTradingHours(now = new Date()): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 9 * 60 + 15 && m <= 15 * 60 + 5;
}

/**
 * 带缓存地取数据。
 *
 * 核心原则：**只要有缓存就立刻返回，刷新永远在后台做**。
 * 用户只在「进程刚启动 / 缓存年龄超过 maxAge」这两种情况下才会等待。
 *
 * @param key      缓存键（调用方自己拼，建议含参数）
 * @param loader   真正打上游的函数
 * @param options  ttl / maxAge
 */
export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheOptions
): Promise<T> {
  const { ttl } = options;
  const maxAge = options.maxAge ?? options.staleTtl ?? 24 * 60 * 60 * 1000;
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit) {
    const age = now - hit.ts;
    // ① 新鲜期：直接给，不刷新
    if (age < ttl) return hit.data;
    // ② 过期但没过 maxAge：立刻给旧的，后台刷新（不阻塞用户）
    //    注意：这里不再有「同步重算」的分支——旧数据总比让用户干等强
    if (age < maxAge) {
      if (!hit.loading) {
        hit.loading = true;
        loader()
          .then((data) => store.set(key, { data, ts: Date.now(), loading: false }))
          .catch(() => {
            // 刷新失败就继续用旧的，不做降级处理
            hit.loading = false;
          });
      }
      return hit.data;
    }
  }

  // ③ 无缓存或超过 maxAge：合并并发请求，同一个 key 只打一次上游
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = loader()
    .then((data) => {
      store.set(key, { data, ts: Date.now(), loading: false });
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** 调试用：看缓存里有哪些 key 及年龄 */
export function cacheStats(): { key: string; ageMs: number; loading: boolean }[] {
  const now = Date.now();
  return Array.from(store.entries()).map(([key, e]) => ({
    key,
    ageMs: now - e.ts,
    loading: e.loading,
  }));
}

/** 清空缓存（调试/手动刷新用） */
export function clearCache(keyPrefix?: string): number {
  if (!keyPrefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(keyPrefix)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}

// ── 磁盘持久化 ─────────────────────────────────────────────
// 为什么需要：内存缓存在服务重启后就空了，用户重启后第一次打开又要等
// 上游（实测 /api/stocks 冷启 1.6s）。把结果落到 cache/api/ 下，
// 重启后直接读盘秒回，再后台刷新 —— 体验上永远不等。
//
// cache/ 已在 .gitignore 里，不会进版本库。

const PERSIST_DIR = path.join(process.cwd(), "cache", "api");

/** 把 key 变成安全的文件名（避免 / : , 等字符）*/
function keyToFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return path.join(PERSIST_DIR, `${safe}.json`);
}

/** 从磁盘读缓存（读不到返回 null）*/
export function readPersisted<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = fs.readFileSync(keyToFile(key), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.ts !== "number") return null;
    return { data: parsed.data as T, ts: parsed.ts };
  } catch {
    return null;
  }
}

/** 写缓存到磁盘（失败静默，不影响主流程）*/
export function writePersisted<T>(key: string, data: T, ts: number): void {
  try {
    fs.mkdirSync(PERSIST_DIR, { recursive: true });
    fs.writeFileSync(keyToFile(key), JSON.stringify({ ts, data }), "utf-8");
  } catch {
    // 磁盘写失败就只保留内存缓存，不打断请求
  }
}

/**
 * 和 cached() 一样，但结果落盘：服务重启后第一次请求也不用等上游。
 * 用于「上游慢且重启会抖」的接口（行情）。
 */
export async function cachedPersistent<T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheOptions
): Promise<T> {
  // 内存里没有就先尝试从磁盘恢复（相当于「重启前的热缓存」）
  if (!store.has(key)) {
    const persisted = readPersisted<T>(key);
    if (persisted) {
      store.set(key, { data: persisted.data, ts: persisted.ts, loading: false });
    }
  }

  // 包装 loader：每次真正打上游拿到新数据时同步落盘。
  // 后台刷新走的也是这个 loader，所以刷新后磁盘也是新的。
  return cached(key, async () => {
    const data = await loader();
    writePersisted(key, data, Date.now());
    return data;
  }, options);
}
