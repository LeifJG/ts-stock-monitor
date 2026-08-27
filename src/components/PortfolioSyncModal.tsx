"use client";

import { useState } from "react";
import { Modal, Input, Tabs, message, Button, Space } from "antd";
import { SyncOutlined } from "@ant-design/icons";

const { TextArea } = Input;

interface PortfolioSyncModalProps {
  open: boolean;
  onClose: () => void;
  onSync?: (data: any[]) => void;
}

export default function PortfolioSyncModal({ open, onClose, onSync }: PortfolioSyncModalProps) {
  const [activeTab, setActiveTab] = useState("paste");
  const [pasteContent, setPasteContent] = useState("");
  const [jsonContent, setJsonContent] = useState("");
  const [syncing, setSyncing] = useState(false);

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
    
    // 处理表头：移除开头的空列
    let headers = lines[0].split(sep).map(h => h.trim());
    if (headers[0] === "") headers = headers.slice(1);
    
    // 银河证券字段映射
    const fieldMap: Record<string, string> = {
      "代码": "code",
      "证券代码": "code",
      "名称": "name",
      "证券名称": "name",
      "余额": "shares",
      "股票余额": "shares",
      "实际数量": "shares",
      "可用": "available",
      "可用余额": "available",
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
      "交易市场": "market",
    };

    const mappedHeaders = headers.map(h => fieldMap[h] || h);
    
    const data: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // 处理数据行：分割并清理
      const rawCols = line.split(sep).map(c => c.trim());
      // 如果第一个元素是空字符串或数字序号，跳过它
      let startIdx = 0;
      if (rawCols[0] === "" || /^\d+$/.test(rawCols[0])) {
        startIdx = 1;
      }
      const cols = rawCols.slice(startIdx);
      
      const row: any = {};
      mappedHeaders.forEach((h, idx) => {
        row[h] = cols[idx] || "";
      });
      
      // 提取必要字段
      const code = (row.code || "").replace(/\s+/g, "");
      const shares = parseInt(row.shares) || parseInt(row["实际数量"]) || 0;
      const cost = parseFloat(row.cost) || parseFloat(row["成本价"]) || 0;
      const price = parseFloat(row.price) || parseFloat(row["市价"]) || cost;
      
      if (!/^\d{6}$/.test(code) || shares <= 0 || cost <= 0) continue;
      
      data.push({
        code,
        name: (row.name || row["证券名称"] || code).replace(/\s+/g, ""),
        shares,
        cost,
        price,
      });
    }

    return data;
  };

  // 解析 JSON
  const parseJSON = (text: string) => {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        message.error("JSON 格式错误，需要数组格式");
        return [];
      }
      
      return data.map(item => ({
        code: item.code?.replace(/\s+/g, ""),
        name: (item.name || item.code || "").replace(/\s+/g, ""),
        shares: parseInt(item.shares || 0),
        cost: parseFloat(item.cost || item.buyPrice || 0),
        price: parseFloat(item.price || item.cost || item.buyPrice || 0),
      })).filter(item => 
        /^\d{6}$/.test(item.code) && 
        !isNaN(item.shares) && 
        !isNaN(item.cost) &&
        item.shares > 0 &&
        item.cost > 0
      );
    } catch (e) {
      message.error("JSON 解析失败");
      return [];
    }
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
        setSyncing(true);
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
      } catch (e: any) {
        message.error(e.message || "导入失败");
      } finally {
        setSyncing(false);
      }
    } else if (activeTab === "json") {
      if (!jsonContent.trim()) {
        message.warning("请先粘贴 JSON 数据");
        return;
      }
      const parsed = parseJSON(jsonContent);
      if (parsed.length === 0) {
        message.error("解析失败，请检查 JSON 格式");
        return;
      }
      
      try {
        setSyncing(true);
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
      } catch (e: any) {
        message.error(e.message || "导入失败");
      } finally {
        setSyncing(false);
      }
    }
  };

  return (
    <Modal
      title="同步持仓"
      open={open}
      onCancel={onClose}
      width={700}
      footer={null}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "paste",
            label: "粘贴表格",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
                  从银河证券或其他券商复制持仓表格，直接粘贴到下方
                </div>
                <TextArea
                  rows={12}
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder={"操作\t序号\t证券代码\t证券名称\t股票余额\t...\t成本价\t市价\t...\n\t1\t600519\t贵州茅台\t100\t...\t1800.00\t1850.00\t..."}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={handleImport}
                  loading={syncing}
                  block
                >
                  导入持仓
                </Button>
              </Space>
            ),
          },
          {
            key: "json",
            label: "JSON 格式",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
                  粘贴 JSON 数组格式，每个对象包含 code、name、shares、cost 字段
                </div>
                <TextArea
                  rows={12}
                  value={jsonContent}
                  onChange={(e) => setJsonContent(e.target.value)}
                  placeholder={`[
  {"code": "600519", "name": "贵州茅台", "shares": 100, "cost": 1800.00, "price": 1850.00},
  {"code": "000858", "name": "五粮液", "shares": 200, "cost": 150.00, "price": 155.00}
]`}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={handleImport}
                  loading={syncing}
                  block
                >
                  导入持仓
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}
