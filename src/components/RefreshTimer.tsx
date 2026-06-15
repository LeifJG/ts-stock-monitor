// ============================================================
// RefreshTimer.tsx — 自动刷新控制栏
// ============================================================
// 提供刷新间隔选择（5/10/30/60 秒或关闭）、手动刷新按钮和上次更新时间显示。

"use client";

interface RefreshTimerProps {
  interval: number;
  onIntervalChange: (sec: number) => void;
  lastUpdated: Date | null;
  onRefresh: () => void;
  loading: boolean;
}

export default function RefreshTimer({
  interval,
  onIntervalChange,
  lastUpdated,
  onRefresh,
  loading,
}: RefreshTimerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">自动刷新：</label>
        <select
          value={interval}
          onChange={(e) => onIntervalChange(parseInt(e.target.value))}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-sm outline-none focus:border-blue-400"
        >
          <option value={5}>5 秒</option>
          <option value={10}>10 秒</option>
          <option value={30}>30 秒</option>
          <option value={60}>60 秒</option>
          <option value={0}>关闭</option>
        </select>

        {lastUpdated && (
          <span className="text-xs text-gray-400">
            更新于 {lastUpdated.toLocaleTimeString("zh-CN")}
          </span>
        )}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className={`inline-block ${loading ? "animate-spin" : ""}`}>
          ↻
        </span>
        刷新
      </button>
    </div>
  );
}
