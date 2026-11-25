// ============================================================
// AppHeader.tsx — 应用顶栏（重构版）
// ============================================================
// 取代原来的 9 个按钮横排，改为分组下拉菜单
// 分组：行情 | 组合 | 分析 | 工具

"use client";

import { Button, Dropdown, Badge, Space, Flex } from "antd";
import type { MenuProps } from "antd";
import {
  TableOutlined,
  AppstoreOutlined,
  BellOutlined,
  CalculatorOutlined,
  WalletOutlined,
  CalendarOutlined,
  PieChartOutlined,
  LineChartOutlined,
  FileTextOutlined,
  BarChartOutlined,
  DownOutlined,
  SunOutlined,
  MoonOutlined,
  DatabaseOutlined,
  FundOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/lib/ThemeContext";
import DataManager from "./DataManager";
import type { ViewMode } from "@/lib/types";

interface AppHeaderProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showAlertPanel: boolean;
  onAlertPanelToggle: () => void;
  showCalculator: boolean;
  onCalculatorToggle: () => void;
  showPortfolio: boolean;
  onPortfolioToggle: () => void;
  showCalendar: boolean;
  onCalendarToggle: () => void;
  showIndustry: boolean;
  onIndustryToggle: () => void;
  showGrid: boolean;
  showCashBond: boolean;
  onCashBondToggle: () => void;
  showInvest: boolean;
  onInvestToggle: () => void;
  onGridToggle: () => void;
  showReport: boolean;
  onReportToggle: () => void;
  showNotes: boolean;
  onNotesToggle: () => void;
  onSyncClick: () => void;
  triggerCount: number;
}

export default function AppHeader({
  viewMode,
  onViewModeChange,
  showAlertPanel,
  onAlertPanelToggle,
  showCalculator,
  onCalculatorToggle,
  showPortfolio,
  onPortfolioToggle,
  showCalendar,
  onCalendarToggle,
  showIndustry,
  onIndustryToggle,
  showGrid,
  showCashBond,
  onCashBondToggle,
  showInvest,
  onInvestToggle,
  onGridToggle,
  showReport,
  onReportToggle,
  showNotes,
  onNotesToggle,
  onSyncClick,
  triggerCount,
}: AppHeaderProps) {
  const { isDark, toggleTheme } = useTheme();

  // 原来按钮高亮是「组内任意一个开着就整体变色」，看不出具体哪个开了。
  // 现在：按钮显示开启数量，菜单项前加 ✓ 标出是哪几个。
  const portfolioOpen = [showPortfolio, showIndustry, showGrid, showCashBond, showInvest].filter(Boolean).length;
  const toolsOpen = [showNotes, showCalculator, showCalendar, showReport].filter(Boolean).length;
  const mark = (on: boolean, label: string) => (on ? `✓ ${label}` : label);

  // ── 行情菜单 ──────────────────────────────────────────────
  const marketMenu: MenuProps["items"] = [
    {
      key: "table",
      label: "表格模式",
      icon: <TableOutlined />,
      onClick: () => onViewModeChange("table"),
    },
    {
      key: "card",
      label: "卡片模式",
      icon: <AppstoreOutlined />,
      onClick: () => onViewModeChange("card"),
    },
    { type: "divider" },
    {
      key: "alert",
      label: (
        <Flex align="center" gap={8}>
          <span>预警管理</span>
          {triggerCount > 0 && (
            <span
              style={{
                background: "#ef4444",
                color: "#fff",
                borderRadius: 9999,
                padding: "0 6px",
                fontSize: 11,
                lineHeight: "18px",
                minWidth: 18,
                textAlign: "center",
              }}
            >
              {triggerCount}
            </span>
          )}
        </Flex>
      ),
      icon: <BellOutlined />,
      onClick: onAlertPanelToggle,
    },
  ];

  // ── 组合菜单 ──────────────────────────────────────────────
  const portfolioMenu: MenuProps["items"] = [
    {
      key: "portfolio",
      label: mark(showPortfolio, "持仓管理"),
      icon: <WalletOutlined />,
      onClick: onPortfolioToggle,
    },
    {
      key: "sync",
      label: "同步持仓",
      icon: <DatabaseOutlined />,
      onClick: onSyncClick,
    },
    {
      key: "industry",
      label: mark(showIndustry, "行业分布"),
      icon: <PieChartOutlined />,
      onClick: onIndustryToggle,
    },
    {
      key: "cashbond",
      label: mark(showCashBond, "现金与股债比"),
      icon: <FundOutlined />,
      onClick: onCashBondToggle,
    },
    {
      key: "invest",
      label: mark(showInvest, "定投日历"),
      icon: <CalendarOutlined />,
      onClick: onInvestToggle,
    },
    {
      key: "grid",
      label: mark(showGrid, "网格交易"),
      icon: <LineChartOutlined />,
      onClick: onGridToggle,
    },
  ];

  // ── 工具菜单 ──────────────────────────────────────────────
  const toolsMenu: MenuProps["items"] = [
    {
      key: "notes",
      label: mark(showNotes, "交易笔记"),
      icon: <EditOutlined />,
      onClick: onNotesToggle,
    },
    { type: "divider" },
    {
      key: "calculator",
      label: mark(showCalculator, "分红计算器"),
      icon: <CalculatorOutlined />,
      onClick: onCalculatorToggle,
    },
    {
      key: "calendar",
      label: mark(showCalendar, "分红日历"),
      icon: <CalendarOutlined />,
      onClick: onCalendarToggle,
    },
    { type: "divider" },
    {
      key: "report",
      label: mark(showReport, "收盘日报"),
      icon: <FileTextOutlined />,
      onClick: onReportToggle,
    },
  ];

  return (
    <Flex justify="space-between" align="center" style={{ marginBottom: 20 }}>
      {/* 左侧：标题 */}
      <Flex align="center" gap={12}>
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.32px",
              color: "var(--text-primary)",
              lineHeight: 1.3,
            }}
          >
            📊 A 股量化看板
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-tertiary)",
              lineHeight: 1.4,
            }}
          >
            实时行情 · 基本面 · 智能预警
          </div>
        </div>
      </Flex>

      {/* 右侧：分组操作 */}
      <Flex gap={6} align="center">
        {/* 当前模式指示 */}
        <span
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--hover-bg)",
            marginRight: 4,
          }}
        >
          {viewMode === "table" ? "表格" : "卡片"}
        </span>

        {/* 视图/模块入口已迁到右侧 SideNav —— 顶栏只留标题、主题、数据管理 */}

        <div style={{ width: 1, height: 20, background: "var(--border-color)", margin: "0 2px" }} />

        {/* Dark mode toggle */}
        <Button
          size="small"
          title={isDark ? "切换浅色" : "切换深色"}
          icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggleTheme}
          style={{ fontSize: 14 }}
        />

        <DataManager type="icon" />
      </Flex>
    </Flex>
  );
}
