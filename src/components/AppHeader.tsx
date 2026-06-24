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
  onGridToggle: () => void;
  showReport: boolean;
  onReportToggle: () => void;
  showNotes: boolean;
  onNotesToggle: () => void;
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
  onGridToggle,
  showReport,
  onReportToggle,
  showNotes,
  onNotesToggle,
  triggerCount,
}: AppHeaderProps) {
  const { isDark, toggleTheme } = useTheme();

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
      label: "持仓管理",
      icon: <WalletOutlined />,
      onClick: onPortfolioToggle,
    },
    {
      key: "industry",
      label: "行业分布",
      icon: <PieChartOutlined />,
      onClick: onIndustryToggle,
    },
    {
      key: "grid",
      label: "网格交易",
      icon: <LineChartOutlined />,
      onClick: onGridToggle,
    },
  ];

  // ── 工具菜单 ──────────────────────────────────────────────
  const toolsMenu: MenuProps["items"] = [
    {
      key: "notes",
      label: "交易笔记",
      icon: <EditOutlined />,
      onClick: onNotesToggle,
    },
    { type: "divider" },
    {
      key: "calculator",
      label: "分红计算器",
      icon: <CalculatorOutlined />,
      onClick: onCalculatorToggle,
    },
    {
      key: "calendar",
      label: "分红日历",
      icon: <CalendarOutlined />,
      onClick: onCalendarToggle,
    },
    { type: "divider" },
    {
      key: "report",
      label: "收盘日报",
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

        {/* 行情 */}
        <Dropdown menu={{ items: marketMenu }} placement="bottomRight" trigger={["click"]}>
          <Button size="small">
            <BarChartOutlined /> 行情 <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>

        {/* 组合 */}
        <Dropdown menu={{ items: portfolioMenu }} placement="bottomRight" trigger={["click"]}>
          <Button size="small" type={showPortfolio || showIndustry || showGrid ? "primary" : "default"}>
            <WalletOutlined /> 组合 <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>

        {/* 工具 */}
        <Dropdown menu={{ items: toolsMenu }} placement="bottomRight" trigger={["click"]}>
          <Button size="small" type={showNotes || showCalculator || showCalendar || showReport ? "primary" : "default"}>
            <CalculatorOutlined /> 工具 <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>

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
