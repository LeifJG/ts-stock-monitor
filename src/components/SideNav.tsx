"use client";

// ============================================================
// SideNav.tsx — 右侧固定导航栏（替代顶部分组下拉菜单）
// ============================================================
// 为什么改：
//   原来 8 个模块藏在「组合」「工具」两个下拉菜单里，按钮高亮是
//   `showPortfolio || showIndustry || showGrid || showCashBond || showInvest`
//   —— 开任意一个整体变色，看不出是哪个；菜单项没状态标记；
//   模块往下堆叠越堆越长，且宽屏时页面两侧大片留白。
//
// 现在：所有模块平铺在右侧导航栏，分组 + 状态一目了然，点击即开合。
//   · 开启项：左侧主色竖条 + 浅底 + ✓
//   · 关闭项：透明底 + 次要色文字
//   · 导航栏 sticky 固定，滚动时始终可见
//   · 底部「全部收起」「同步持仓」常驻

import { Flex, Typography, Badge, Tooltip } from "antd";
import type { ViewMode } from "@/lib/types";

const { Text } = Typography;

export interface NavItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onToggle: () => void;
  /** 右侧角标（如预警触发数） */
  badge?: number;
  /** 弹窗类模块：点击即打开，不参与「展开/收起」计数 */
  modal?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

interface SideNavProps {
  groups: NavGroup[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onCollapseAll: () => void;
  onSyncClick: () => void;
  /** 已展开的内联模块数（不含弹窗） */
  activeCount: number;
}

export default function SideNav({
  groups,
  viewMode,
  onViewModeChange,
  onCollapseAll,
  onSyncClick,
  activeCount,
}: SideNavProps) {
  return (
    <nav
      style={{
        width: 208,
        flexShrink: 0,
        fontSize: 12.5,
        background: "var(--bg-secondary, transparent)",
        border: "1px solid var(--border-color)",
        borderRadius: 10,
        padding: "12px 10px",
      }}
    >
      {groups.map((g, gi) => (
        <div key={g.title} style={{ marginTop: gi === 0 ? 0 : 14 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.4,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              padding: "0 8px 6px",
            }}
          >
            {g.title}
          </div>

          {g.items.map((it) => {
            // 视图模式（表格/卡片）是互斥单选，用另一套渲染
            const on = it.active;
            return (
              <div
                key={it.key}
                role="button"
                tabIndex={0}
                onClick={it.onToggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    it.onToggle();
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  userSelect: "none",
                  marginBottom: 1,
                  transition: "background 0.12s",
                  borderLeft: `2px solid ${on ? "var(--accent, #1677ff)" : "transparent"}`,
                  background: on ? "var(--hover-bg, rgba(22,119,255,0.09))" : "transparent",
                  color: on ? "var(--accent, #1677ff)" : "var(--text-secondary)",
                  fontWeight: on ? 600 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!on) e.currentTarget.style.background = "var(--hover-bg, rgba(128,128,128,0.09))";
                }}
                onMouseLeave={(e) => {
                  if (!on) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ fontSize: 13, opacity: on ? 1 : 0.7, width: 16, textAlign: "center" }}>
                  {it.icon}
                </span>
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {it.label}
                </span>
                {it.badge != null && it.badge > 0 && (
                  <Badge count={it.badge} size="small" style={{ fontSize: 10 }} />
                )}
                {on && !it.modal && <span style={{ fontSize: 11 }}>✓</span>}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── 底部操作 ── */}
      <div style={{ borderTop: "1px solid var(--border-color)", marginTop: 12, paddingTop: 10 }}>
        <Tooltip title="当前视图模式，点击切换">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onViewModeChange(viewMode === "table" ? "card" : "table")}
            onKeyDown={(e) => {
              if (e.key === "Enter") onViewModeChange(viewMode === "table" ? "card" : "table");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 8px",
              borderRadius: 6,
              cursor: "pointer",
              color: "var(--text-secondary)",
              marginBottom: 2,
            }}
          >
            <span>视图</span>
            <Text style={{ fontSize: 11.5, color: "var(--accent, #1677ff)" }}>
              {viewMode === "table" ? "表格" : "卡片"}
            </Text>
          </div>
        </Tooltip>

        <div
          role="button"
          tabIndex={0}
          onClick={onSyncClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSyncClick();
          }}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "5px 8px",
            borderRadius: 6, cursor: "pointer", color: "var(--text-secondary)",
          }}
        >
          <span style={{ width: 16, textAlign: "center" }}>⇄</span>
          <span>同步持仓</span>
        </div>

        {activeCount > 0 && (
          <Flex justify="space-between" align="center" style={{ padding: "6px 8px 0" }}>
            <Text style={{ fontSize: 11, color: "var(--text-tertiary)" }}>已展开 {activeCount}</Text>
            <Text
              onClick={onCollapseAll}
              style={{ fontSize: 11, cursor: "pointer", color: "var(--accent, #1677ff)" }}
            >
              全部收起
            </Text>
          </Flex>
        )}
      </div>
    </nav>
  );
}
