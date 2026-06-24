// ============================================================
// DailyReport.tsx — 日报弹窗（Modal 展示，优化排版）
// ============================================================

"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal, Typography, Spin, Button, Flex, Tag, Divider } from "antd";
import { ReloadOutlined, FileTextOutlined } from "@ant-design/icons";

const { Text } = Typography;

// 颜色映射：常见 emoji 前缀 → 颜色
function guessSectionColor(line: string): string | null {
  if (line.includes("📡")) return "#8b5cf6";
  if (line.includes("🎯")) return "#f59e0b";
  if (line.includes("💡")) return "#10b981";
  if (line.includes("📊")) return "#3b82f6";
  if (line.includes("📈")) return "#22c55e";
  if (line.includes("📉")) return "#ef4444";
  if (line.includes("💰")) return "#16a34a";
  if (line.includes("🔴") || line.includes("🟡") || line.includes("🟢") || line.includes("🔵"))
    return null; // will be colored by the item itself
  return null;
}

function formatContent(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let key = 0;

  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows = [];
      return;
    }
    // 解析表头
    const header = tableRows[0].replace(/^\||\|$/g, "").split("|").map(s => s.trim());
    // 分隔行（|---|---|）
    // 数据行
    const dataRows = tableRows.slice(1).filter(r => !r.match(/^[\s\|:-]+$/));
    if (header.length >= 2 && dataRows.length > 0) {
      nodes.push(
        <div key={key++} style={{ margin: "6px 0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: "left",
                      padding: "3px 8px",
                      borderBottom: "1px solid #e5e7eb",
                      fontWeight: 600,
                      color: "#6b7280",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => {
                const cells = row.replace(/^\||\|$/g, "").split("|").map(s => s.trim());
                return (
                  <tr key={ri}>
                    {cells.map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          padding: "3px 8px",
                          borderBottom: "1px solid #f3f4f6",
                          whiteSpace: "nowrap",
                          color: cell.includes("**") ? "#3b82f6" : "#374151",
                          fontWeight: cell.includes("**") ? 600 : 400,
                        }}
                        dangerouslySetInnerHTML={{
                          __html: cell.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                        }}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    } else {
      // 不是真表格，当普通文本放回去
      for (const r of tableRows) {
        nodes.push(
          <div key={key++} style={{ padding: "2px 0", fontSize: 12, color: "#374151" }}>
            {r}
          </div>
        );
      }
    }
    tableRows = [];
    inTable = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 分隔线
    if (line.match(/^---+$/)) {
      flushTable();
      // thinner divider
      nodes.push(<div key={key++} style={{ height: 1, background: "#f0f0f0", margin: "8px 0" }} />);
      continue;
    }

    // 空行 → 间距
    if (line === "") {
      flushTable();
      nodes.push(<div key={key++} style={{ height: 4 }} />);
      continue;
    }

    // 表格行
    if (line.startsWith("|") && line.endsWith("|")) {
      inTable = true;
      tableRows.push(line);
      continue;
    }

    // 非表格 → 先刷新表格
    flushTable();

    // 行情报价特殊处理：|---:|:---|
    if (line.match(/^[\s\|:-]+$/)) continue;

    // 板块标题（─── XXX ───）
    if (line.includes("───")) {
      const title = line.replace(/─/g, "").trim();
      const color = guessSectionColor(line) || "#6b7280";
      nodes.push(
        <div key={key++} style={{ margin: "10px 0 6px 0" }}>
          <Text strong style={{ fontSize: 13, color }}>{title}</Text>
        </div>
      );
      continue;
    }

    // 块级引用（> xxx）
    if (line.startsWith(">")) {
      nodes.push(
        <div
          key={key++}
          style={{
            padding: "4px 10px",
            margin: "4px 0",
            background: "#f9fafb",
            borderLeft: "3px solid #d1d5db",
            borderRadius: 4,
            fontSize: 11,
            color: "#6b7280",
          }}
        >
          {line.replace(/^>\s?/, "")}
        </div>
      );
      continue;
    }

    // 粗体标题行（以 `**` 开头）
    const boldMatch = line.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      nodes.push(
        <div key={key++} style={{ margin: "6px 0 4px 0" }}>
          <Text strong style={{ fontSize: 12, color: "#374151" }}>
            {line.replace(/\*\*(.+?)\*\*/g, "$1")}
          </Text>
        </div>
      );
      continue;
    }

    // 列表项（- xxx）
    if (line.startsWith("- ")) {
      const itemText = line.slice(2);
      // 着色标记
      let color = "#374151";
      if (itemText.includes("🔴")) color = "#ef4444";
      else if (itemText.includes("🟡")) color = "#d97706";
      else if (itemText.includes("🟢")) color = "#16a34a";
      else if (itemText.includes("🔵")) color = "#3b82f6";

      nodes.push(
        <div key={key++} style={{ padding: "1px 0", fontSize: 12, lineHeight: 1.7, color }}>
          <span>{line}</span>
        </div>
      );
      continue;
    }

    // ### 标题
    if (line.startsWith("### ")) {
      nodes.push(
        <div key={key++} style={{ margin: "8px 0 4px 0" }}>
          <Text strong style={{ fontSize: 13, color: "#111827" }}>
            {line.replace(/^###\s*/, "")}
          </Text>
        </div>
      );
      continue;
    }

    // 默认文本行（含加粗）
    nodes.push(
      <div key={key++} style={{ padding: "1px 0", fontSize: 12, lineHeight: 1.7, color: "#374151" }}>
        <span
          dangerouslySetInnerHTML={{
            __html: line
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\n/g, "<br/>"),
          }}
        />
      </div>
    );
  }
  flushTable();

  return nodes;
}

// ─── 组件 ─────────────────────────────────────────────────

interface DailyReportProps {
  open: boolean;
  onClose: () => void;
}

export default function DailyReport({ open, onClose }: DailyReportProps) {
  const [content, setContent] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-report");
      const data = await res.json();
      if (data.success && data.content) {
        setContent(data.content);
        setGeneratedAt(data.generatedAt);
      } else {
        setError(data.error || "暂无日报数据");
      }
    } catch (err: any) {
      setError(err.message || "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  // 弹窗打开时自动加载
  useEffect(() => {
    if (open) {
      fetchReport();
    }
  }, [open, fetchReport]);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
      return cst.toISOString().replace("T", " ").slice(0, 16);
    } catch {
      return iso;
    }
  };

  return (
    <Modal
      title={
        <Flex align="center" gap={8}>
          <FileTextOutlined style={{ color: "#8b5cf6" }} />
          <span>📋 收盘日报</span>
          {generatedAt && (
            <Tag color="default" style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>
              {formatTime(generatedAt)}
            </Tag>
          )}
        </Flex>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      {/* 工具栏 */}
      <Flex
        justify="flex-end"
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid #f0f0f0",
          background: "#fafafa",
        }}
      >
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={fetchReport}
          loading={loading}
        >
          刷新
        </Button>
      </Flex>

      {/* 正文 */}
      <div
        style={{
          padding: 16,
          maxHeight: "60vh",
          overflow: "auto",
          background: "#fefefe",
        }}
      >
        {loading ? (
          <Flex justify="center" style={{ padding: 40 }}>
            <Spin />
          </Flex>
        ) : error ? (
          <Flex
            justify="center"
            align="center"
            style={{ minHeight: 120, color: "#9ca3af", fontSize: 13 }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ marginBottom: 4 }}>📭 {error}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                日报由定时任务在交易日 7:30 生成
              </Text>
            </div>
          </Flex>
        ) : (
          <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Courier New', monospace" }}>
            {formatContent(content || "")}
          </div>
        )}
      </div>
    </Modal>
  );
}
