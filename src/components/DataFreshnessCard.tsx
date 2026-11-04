"use client";

// ============================================================
// DataFreshnessCard.tsx — 「数据更新时间」卡片
//
// 目的：让用户一眼看出页面上的数字是什么时候的、是不是定时任务刷的。
// 背景：2026-11 出过"分位用了两年前数据却看不出来"的事故，
//       所以这里把每个数据源的上次更新 / 刷新频率 / 是否过期全部摊开。
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Space, Table, Tag, Typography } from "antd";
import {
  cadenceLabel,
  formatAge,
  type FreshnessRow,
  type FreshnessStatus,
} from "@/lib/data-freshness";

const { Text } = Typography;

interface ScheduleItem {
  label: string;
  detail: string;
}

interface ApiResponse {
  success: boolean;
  data: {
    updatedAt: string;
    schedule: ScheduleItem[];
    rows: FreshnessRow[];
    summary: {
      total: number;
      ok: number;
      late: number;
      stale: number;
      missing: number;
      headline: string;
    };
  };
}

const STATUS_META: Record<FreshnessStatus, { color: string; text: string }> = {
  ok: { color: "green", text: "正常" },
  late: { color: "gold", text: "偏旧" },
  stale: { color: "red", text: "过期" },
  missing: { color: "default", text: "缺失" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DataFreshnessCard() {
  const [rows, setRows] = useState<FreshnessRow[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [summary, setSummary] = useState<ApiResponse["data"]["summary"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/data-freshness", { cache: "no-store" });
      const json: ApiResponse = await res.json();
      if (json.success) {
        setRows(json.data.rows);
        setSchedule(json.data.schedule);
        setSummary(json.data.summary);
        setCheckedAt(json.data.updatedAt);
      }
    } catch {
      // 静默：卡片自己会显示"缺失"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = [
    {
      title: "数据",
      dataIndex: "label",
      key: "label",
      render: (label: string, r: FreshnessRow) => (
        <Space direction="vertical" size={0}>
          <Text strong>{label}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {cadenceLabel(r.cadence)} · {r.refresher}
          </Text>
          {r.note ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.note}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "上次更新",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 190,
      render: (v: string | null, r: FreshnessRow) => (
        <Space direction="vertical" size={0}>
          <Text>{fmtTime(v)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatAge(r.ageHours)}
            {r.dataDate ? ` · 数据日 ${r.dataDate}` : ""}
          </Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (s: FreshnessStatus) => (
        <Tag color={STATUS_META[s].color}>{STATUS_META[s].text}</Tag>
      ),
    },
  ];

  // 默认只显示过期的（避免 16 行噪音），全量展开可看
  const problems = rows.filter((r) => r.status !== "ok");
  const shown = expanded ? rows : problems.length > 0 ? problems : rows;

  return (
    <Card
      title={
        <Space>
          <span>🕒 数据更新时间</span>
          {summary ? (
            <Tag color={summary.late + summary.stale + summary.missing === 0 ? "green" : "orange"}>
              {summary.headline}
            </Tag>
          ) : null}
        </Space>
      }
      extra={
        <Space>
          {checkedAt ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              检查于 {fmtTime(checkedAt)}
            </Text>
          ) : null}
          <Button size="small" onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          页面数据全部来自本地缓存文件，由定时任务自动刷新（不需要你手动跑）。
          下面列出每项「上次更新是什么时候」，过期的会用红标提醒——红标的数据不要拿来做决策。
        </Text>

        <Table
          size="small"
          rowKey="key"
          dataSource={shown}
          columns={columns as never}
          pagination={false}
          locale={{ emptyText: "暂无数据" }}
        />

        <Space>
          <Button size="small" type="link" onClick={() => setExpanded(!expanded)}>
            {expanded
              ? `收起（只看异常项）`
              : `显示全部 ${rows.length} 项数据`}
          </Button>
          {problems.length > 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前 {problems.length} 项需要关注
            </Text>
          ) : null}
        </Space>

        <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
          <Text strong style={{ fontSize: 12 }}>
            定时刷新计划
          </Text>
          {schedule.map((s) => (
            <div key={s.label} style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              · <Text style={{ fontSize: 12 }}>{s.label}</Text> — {s.detail}
            </div>
          ))}
        </div>
      </Space>
    </Card>
  );
}
