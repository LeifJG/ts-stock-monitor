// ============================================================
// DataManager.tsx — 数据导入导出工具
// ============================================================
// 一键导出/导入所有持仓、自选、告警、网格配置，
// 方便换地址、换浏览器、备份迁移。

"use client";

import { useState, useCallback, useRef } from "react";
import { Button, Modal, Flex, Typography, Divider, Space, Upload, message } from "antd";
import {
  DownloadOutlined, UploadOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

// ─── 存储键名 ──────────────────────────────────────────────

const STORAGE_KEYS = {
  portfolio: "ts-stock-monitor:portfolio",
  watchlist: "ts-stock-monitor:watchlist",
  alertRules: "ts-stock-monitor:alertRules",
  gridSettings: "ts-stock-monitor:grid-settings2",
  viewMode: "ts-stock-monitor:viewMode",
  showPortfolio: "ts-stock-monitor:showPortfolio",
};

// ─── 类型 ─────────────────────────────────────────────────

export interface AppData {
  version: string;
  exportedAt: string;
  data: {
    [key: string]: any; // storage keys → their values
  };
}

// ─── 工具函数 ─────────────────────────────────────────────

/** 导出自定义数据（收集所有自定义 localStorage） */
export function exportAppData(): AppData {
  const data: Record<string, any> = {};

  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        data[key] = JSON.parse(raw);
      }
    } catch {
      // skip corrupted entries
    }
  }

  return {
    version: "2",
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** 导入数据到 localStorage */
export function importAppData(appData: AppData): { success: boolean; imported: string[]; errors: string[] } {
  const imported: string[] = [];
  const errors: string[] = [];

  for (const [key, value] of Object.entries(appData.data)) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      imported.push(key);
    } catch (e: any) {
      errors.push(`${key}: ${e.message}`);
    }
  }

  return { success: errors.length === 0, imported, errors };
}

/** 下载 JSON 文件 */
export function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 组件 ─────────────────────────────────────────────────

interface DataManagerProps {
  /** 自定义触发方式（可选），默认是文本按钮 */
  type?: "icon" | "text" | "menu";
}

export default function DataManager({ type = "icon" }: DataManagerProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "exported" | "importing" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const data = exportAppData();
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    downloadJSON(data, `ts-stock-monitor-backup-${ts}.json`);
    setStatus("exported");
    setMsg("文件已下载，请妥善保管");
    setTimeout(() => setStatus("idle"), 3000);
  }, []);

  const handleImport = useCallback((file: File) => {
    setStatus("importing");
    setMsg("正在导入...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const appData: AppData = JSON.parse(content);

        // 格式校验
        if (!appData.version || !appData.data) {
          throw new Error("文件格式不正确，请确认导入了正确的备份文件");
        }

        const result = importAppData(appData);

        if (result.errors.length > 0) {
          setStatus("error");
          setMsg(`导入完成但有 ${result.errors.length} 个错误：${result.errors[0]}`);
        } else {
          setStatus("done");
          setMsg(`✅ 已成功导入 ${result.imported.length} 项数据，页面将自动刷新`);
          // 延迟刷新，让用户看到成功提示
          setTimeout(() => window.location.reload(), 2000);
        }
      } catch (err: any) {
        setStatus("error");
        setMsg("导入失败：" + err.message);
      }
    };
    reader.onerror = () => {
      setStatus("error");
      setMsg("文件读取失败");
    };
    reader.readAsText(file);
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
    // Reset so the same file can be re-imported
    e.target.value = "";
  }, [handleImport]);

  const statusColor = status === "done" ? "#16a34a" : status === "error" ? "#ef4444" : "#2563eb";

  return (
    <>
      {/* 触发按钮 */}
      {type === "icon" ? (
        <Button size="small" icon={<DownloadOutlined />} onClick={() => setOpen(true)}>
          数据
        </Button>
      ) : (
        <Button type="link" icon={<DownloadOutlined />} onClick={() => setOpen(true)}>
          数据管理
        </Button>
      )}

      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* 弹窗 */}
      <Modal
        title="📦 数据管理"
        open={open}
        onCancel={() => { setOpen(false); setStatus("idle"); }}
        footer={null}
        width={420}
        destroyOnClose
      >
        <div style={{ padding: "8px 0" }}>
          <Text type="secondary" style={{ fontSize: 13, display: "block", marginBottom: 16 }}>
            导出数据在所有页面（localhost、IP 地址、不同浏览器之间）通用。
            支持：持仓记录 · 自选股 · 告警规则 · 网格设置
          </Text>

          {/* 导出 */}
          <div style={{
            padding: 16, borderRadius: 8, border: "1px solid #e5e7eb",
            marginBottom: 12, background: "#fafafa",
          }}>
            <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
              <DownloadOutlined style={{ fontSize: 16, color: "#2563eb" }} />
              <Text strong>导出数据</Text>
            </Flex>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              下载当前所有数据为 JSON 文件，搬家前跑一次。
            </Text>
            <Button
              type="primary"
              size="small"
              icon={<DownloadOutlined />}
              onClick={handleExport}
            >
              导出
            </Button>
          </div>

          {/* 导入 */}
          <div style={{
            padding: 16, borderRadius: 8, border: "1px solid #e5e7eb",
            background: "#fafafa",
          }}>
            <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
              <UploadOutlined style={{ fontSize: 16, color: "#16a34a" }} />
              <Text strong>导入数据</Text>
            </Flex>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              上传之前导出的备份 JSON 文件，恢复全部数据。
              <br />
              <Text type="warning" style={{ fontSize: 11 }}>
                注意：导入会覆盖当前数据
              </Text>
            </Text>
            <Button
              type="default"
              size="small"
              icon={<UploadOutlined />}
              onClick={handleFileSelect}
            >
              选择文件导入
            </Button>
          </div>

          {/* 状态提示 */}
          {status !== "idle" && (
            <div style={{
              marginTop: 12, padding: "8px 12px", borderRadius: 6,
              background: status === "done" ? "#f0fdf4" : status === "error" ? "#fef2f2" : "#eff6ff",
              border: `1px solid ${statusColor}33`,
              color: statusColor, fontSize: 13,
            }}>
              <Flex align="center" gap={6}>
                {status === "done" ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
                <span>{msg}</span>
              </Flex>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
