"use client";

import { useState } from "react";
import { Modal, Button, Tabs, Input, message, Typography, Space } from "antd";
import { CloudUploadOutlined, CopyOutlined, FileExcelOutlined } from "@ant-design/icons";

const { TextArea } = Input;
const { Text, Title } = Typography;

interface PortfolioSyncModalProps {
  open: boolean;
  onClose: () => void;
  onSync?: (data: any[]) => void;
}

export default function PortfolioSyncModal({ open, onClose, onSync }: PortfolioSyncModalProps) {
  const [activeTab, setActiveTab] = useState("paste");
  const [pasteContent, setPasteContent] = useState("");
  const [jsonContent, setJsonContent] = useState("");

  // 解析 CSV/表格粘贴内容（支持银河证券格式）
  const parseCSV = (text: string) => {
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) {
      message.error("数据太少，至少需要表头+1行数据");
      return [];
    }

    // 自动检测分隔符（银河证券用 Tab）
    const firstLine = lines[0];
    const sep = firstLine.includes("\t") ? "\t" : firstLine.includes(",") ? "," : " ";
    
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
    
    // 银河证券字段映射
    const fieldMap: Record<string, string> = {
      "代码": "code",
      "名称": "name",
      "余额": "shares",
      "可用": "available",
      "成本价": "cost",
      "市价": "price",
      "盈亏": "profit",
      "盈亏比(%)": "profitPct",
      "当日盈亏": "dayProfit",
      "当日盈亏比(%)": "dayProfitPct",
      "市值": "marketValue",
      "仓位占比(%)": "positionPct",
      "证券账户": "account",
      "当日买入": "dayBuy",
      "当日卖出": "daySell",
      "持股天数": "holdDays",
    };

    const mappedHeaders = headers.map(h => fieldMap[h] || h);
    
    const data: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim());
      const row: any = {};
      mappedHeaders.forEach((h, idx) => {
        row[h] = cols[idx] || "";
      });
      
      // 提取必要字段
      if (row.code && row.cost && row.shares) {
        data.push({
          code: row.code,
          name: row.name,
          shares: parseInt(row.shares),
          cost: parseFloat(row.cost),
          price: row.price ? parseFloat(row.price) : parseFloat(row.cost),
        });
      }
    }

    return data;
  };

  // 导入持仓
  const handleImport = async () => {
    if (activeTab === "paste") {
      if (!pasteContent.trim()) {
        message.warning("请先粘贴数据");
        return;
      }
      const parsed = parseCSV(pasteContent);
      if (parsed.length === 0) {
        message.error("解析失败，请检查格式");
        return;
      }
      
      // 调用 API 保存
      try {
        const res = await fetch("/api/portfolio/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: parsed, source: "paste" }),
        });
        const json = await res.json();
        if (json.success) {
          message.success(`成功导入 ${parsed.length} 条持仓`);
          onSync?.(parsed);
          setPasteContent("");
          onClose();
        } else {
          message.error(json.error || "导入失败");
        }
      } catch (err) {
        message.error("网络错误");
      }
    } else if (activeTab === "json") {
      try {
        const parsed = JSON.parse(jsonContent);
        if (!Array.isArray(parsed)) {
          message.error("JSON 必须是数组");
          return;
        }
        
        const res = await fetch("/api/portfolio/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: parsed, source: "json" }),
        });
        const json = await res.json();
        if (json.success) {
          message.success(`成功导入 ${parsed.length} 条持仓`);
          onSync?.(parsed);
          setJsonContent("");
          onClose();
        } else {
          message.error(json.error || "导入失败");
        }
      } catch (err) {
        message.error("JSON 格式错误");
      }
    }
  };

  const tabItems = [
    {
      key: "paste",
      label: (
        <span>
          <CopyOutlined /> 粘贴表格
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text type="secondary">
              从银河证券复制持仓表格，直接粘贴到下方（支持 Excel/网页表格/CSV）
            </Text>
          </div>
          <TextArea
            rows={10}
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder={`示例（从银河证券复制后粘贴）：
代码\t名称\t余额\t可用\t成本价\t市价\t盈亏\t盈亏比(%)\t当日盈亏\t当日盈亏比(%)\t市值\t仓位占比(%)\t证券账户\t当日买入\t当日卖出\t持股天数
000333\t美的集团\t300\t300\t50.932\t85.430\t10349.47\t67.73\t-288.00\t-1.11\t25629.00\t4.52\t银河 李*高\t0\t0\t266`}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 提示：支持 Tab/逗号/空格分隔，第一行自动识别为表头
          </Text>
        </Space>
      ),
    },
    {
      key: "json",
      label: (
        <span>
          <FileExcelOutlined /> JSON 数据
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text type="secondary">
              高级用户：直接粘贴 JSON 数组（适合程序化导入）
            </Text>
          </div>
          <TextArea
            rows={10}
            value={jsonContent}
            onChange={(e) => setJsonContent(e.target.value)}
            placeholder={`[
  {
    "code": "600519",
    "name": "贵州茅台",
    "shares": 100,
    "cost": 1800.00,
    "price": 1850.00
  }
]`}
          />
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <CloudUploadOutlined />
          <span>持仓同步</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={700}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="import" type="primary" onClick={handleImport}>
          导入持仓
        </Button>,
      ]}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      
      <div style={{ marginTop: 16, padding: 12, background: "#f6f8fa", borderRadius: 6 }}>
        <Title level={5} style={{ margin: "0 0 8px 0" }}>
          📋 银河证券导出方法
        </Title>
        <Text style={{ fontSize: 13 }}>
          <strong>方法1：</strong>
          银河证券客户端 → 持仓 → 选中全部 → Ctrl+C 复制 → 粘贴到上方
        </Text>
        <br />
        <Text style={{ fontSize: 13 }}>
          <strong>方法2：</strong>
          手机银河 APP → 持仓 → 长按某条 → 全选 → 分享/复制（部分版本支持）
        </Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: "block" }}>
          💡 如果无法导出，可以手动在"持仓管理"面板逐条添加
        </Text>
      </div>
    </Modal>
  );
}
