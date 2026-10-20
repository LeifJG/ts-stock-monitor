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

interface Entry<T> {
  data: T;
  ts: number;      // 写入时间
  loading: boolean; // 是否正在后台刷新
}

export interface CacheOptions {
  /** 新鲜期（毫秒）：这段时间内直接返回不刷新 */
  ttl: number;
  /** 陈旧期（毫秒）：超过 ttl 但未超过这个值，返回旧数据 + 后台刷新 */
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
 * @param key      缓存键（调用方自己拼，建议含参数）
 * @param loader   真正打上游的函数
 * @param options  ttl / staleTtl
 */
export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheOptions
): Promise<T> {
  const { ttl, staleTtl = ttl * 3 } = options;
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit) {
    const age = now - hit.ts;
    // ① 新鲜期：直接给
    if (age < ttl) return hit.data;
    // ② 陈旧期：先给旧的，后台刷新（不阻塞用户）
    if (age < staleTtl) {
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

  // ③ 无缓存或太旧：合并并发请求，同一个 key 只打一次上游
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
