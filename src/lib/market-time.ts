// ============================================================
// market-time.ts — A股/港股通交易时间检测
// ============================================================

/** A 股/港股通交易时段（北京时间 UTC+8） */
const SESSION_1_START = { h: 9, m: 30 };   // 上午 9:30
const SESSION_1_END = { h: 11, m: 30 };    // 上午 11:30
const SESSION_2_START = { h: 13, m: 0 };   // 下午 13:00
const SESSION_2_END = { h: 15, m: 0 };     // 下午 15:00

/** 获取当前北京时间 */
function getBeijingNow(): Date {
  const now = new Date();
  // 本地时间 → UTC → 北京时间
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export interface MarketStatus {
  isOpen: boolean;        // 是否正在交易
  isToday: boolean;       // 是否为交易日（含周末判定）
  nextOpen: string | null;  // 下次开盘时间描述
  nextClose: string | null; // 下次收盘时间描述
  session: "morning" | "afternoon" | "closed";
}

/** 判断今日是否为交易日（简版：仅排除周末） */
function isTradingDay(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5; // 周一到周五
}

/** 获取交易状态 */
export function getMarketStatus(): MarketStatus {
  const bj = getBeijingNow();
  const mins = toMinutes(bj);
  const day = bj.getDay();

  // 周末
  if (day === 0 || day === 6) {
    // 计算下一个周一
    const daysUntilMon = day === 0 ? 1 : 2;
    return {
      isOpen: false,
      isToday: false,
      nextOpen: daysUntilMon === 1 ? "明天 9:30" : "周一 9:30",
      nextClose: null,
      session: "closed",
    };
  }

  const s1Start = SESSION_1_START.h * 60 + SESSION_1_START.m;
  const s1End = SESSION_1_END.h * 60 + SESSION_1_END.m;
  const s2Start = SESSION_2_START.h * 60 + SESSION_2_START.m;
  const s2End = SESSION_2_END.h * 60 + SESSION_2_END.m;

  // 上午盘
  if (mins >= s1Start && mins < s1End) {
    return {
      isOpen: true,
      isToday: true,
      nextOpen: null,
      nextClose: `11:30 (${Math.floor((s1End - mins) / 60)}h${(s1End - mins) % 60}m后)`,
      session: "morning",
    };
  }

  // 下午盘
  if (mins >= s2Start && mins < s2End) {
    return {
      isOpen: true,
      isToday: true,
      nextOpen: null,
      nextClose: `15:00 (${Math.floor((s2End - mins) / 60)}h${(s2End - mins) % 60}m后)`,
      session: "afternoon",
    };
  }

  // 中午休市
  if (mins >= s1End && mins < s2Start) {
    return {
      isOpen: false,
      isToday: true,
      nextOpen: `13:00 (${Math.floor((s2Start - mins) / 60)}h${(s2Start - mins) % 60}m后)`,
      nextClose: null,
      session: "closed",
    };
  }

  // 已收盘（15:00 之后）
  if (mins >= s2End && mins < 24 * 60) {
    return {
      isOpen: false,
      isToday: true,
      nextOpen: "明天 9:30",
      nextClose: null,
      session: "closed",
    };
  }

  // 盘前（0:00 - 9:30）
  return {
    isOpen: false,
    isToday: true,
    nextOpen: `9:30 (${Math.floor((s1Start - mins) / 60)}h${(s1Start - mins) % 60}m后)`,
    nextClose: null,
    session: "closed",
  };
}

/** 下次收盘距现在还有多少毫秒（用于定时任务调度） */
export function getMsUntilMarketClose(): number {
  const bj = getBeijingNow();
  const mins = toMinutes(bj);
  const s2End = SESSION_2_END.h * 60 + SESSION_2_END.m;

  const closeMins = s2End - mins;
  if (closeMins > 0) return closeMins * 60000;

  // 已收盘 → 明天
  return 0;
}

/** 判断是否应该开启自动刷新 */
export function shouldAutoRefresh(): boolean {
  return getMarketStatus().isOpen;
}
