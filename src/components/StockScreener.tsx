// ============================================================
// StockScreener.tsx — 智能筛选面板（可折叠）
// ============================================================

"use client";

import { useState, useCallback } from "react";
import { Button, Flex, Tag, Tooltip, InputNumber, Collapse } from "antd";
import { FilterOutlined, ClearOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import type { ScreenerFilters } from "@/lib/scorer";
import { DEFAULT_FILTERS, PRESETS } from "@/lib/scorer";

interface StockScreenerProps {
  filters: ScreenerFilters;
  onChange: (filters: ScreenerFilters) => void;
  activeCount: number;  // 匹配股票数
  totalCount: number;   // 总股票数
}

export default function StockScreener({ filters, onChange, activeCount, totalCount }: StockScreenerProps) {
  const [open, setOpen] = useState(false);

  const isActive = Object.values(filters).some((v) => v != null);
  const presetKey = Object.entries(PRESETS).find(([, p]) =>
    Object.entries(p.filters).every(([k, v]) => (filters as any)[k] === v)
  )?.[0];

  const setFilter = useCallback((key: keyof ScreenerFilters, value: number | null) => {
    onChange({ ...filters, [key]: value });
  }, [filters, onChange]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    onChange({ ...DEFAULT_FILTERS, ...preset.filters });
  }, [onChange]);

  const clearAll = useCallback(() => {
    onChange({ ...DEFAULT_FILTERS });
  }, [onChange]);

  const activeFilterCount = Object.entries(filters).filter(([, v]) => v != null).length;

  return (
    <div style={{
      borderRadius: 8,
      background: "var(--bg-card)",
      boxShadow: "var(--card-shadow)",
      marginBottom: 12,
    }}>
      {/* 折叠头部 */}
      <Flex
        align="center"
        justify="space-between"
        style={{ padding: "10px 14px", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <Flex align="center" gap={8}>
          <FilterOutlined style={{ color: "var(--text-tertiary)" }} />
          <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text-primary)" }}>
            智能筛选
          </span>
          {isActive && (
            <Tag color="blue" style={{ borderRadius: 9999, fontSize: 10, lineHeight: "18px", padding: "0 8px" }}>
              {activeFilterCount} 个条件 · {activeCount}/{totalCount} 只
            </Tag>
          )}
          {!isActive && (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              点击展开筛选条件
            </span>
          )}
        </Flex>
        <Flex align="center" gap={6}>
          {isActive && (
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
              style={{ fontSize: 11, color: "var(--text-tertiary)" }}
            >
              清除
            </Button>
          )}
          {open ? <UpOutlined style={{ fontSize: 10, color: "var(--text-tertiary)" }} /> :
                   <DownOutlined style={{ fontSize: 10, color: "var(--text-tertiary)" }} />}
        </Flex>
      </Flex>

      {/* 折叠内容 */}
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border-secondary)" }}>
          {/* 预设按钮 */}
          <Flex gap={6} wrap="wrap" style={{ marginTop: 10, marginBottom: 12 }}>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <Button
                key={key}
                size="small"
                type={presetKey === key ? "primary" : "default"}
                onClick={() => applyPreset(key)}
                style={{ fontSize: 11, borderRadius: 9999 }}
              >
                {preset.icon} {preset.label}
              </Button>
            ))}
          </Flex>

          {/* 筛选条件网格 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FilterField
              label="PE 最小值"
              value={filters.peMin}
              onChange={(v) => setFilter("peMin", v)}
              placeholder="不限"
            />
            <FilterField
              label="PE 最大值"
              value={filters.peMax}
              onChange={(v) => setFilter("peMax", v)}
              placeholder="不限"
            />
            <FilterField
              label="股息率 ≥ ( % )"
              value={filters.dividendYieldMin}
              onChange={(v) => setFilter("dividendYieldMin", v)}
              placeholder="不限"
              step={0.5}
            />
            <FilterField
              label="ROE ≥ ( % )"
              value={filters.roeMin}
              onChange={(v) => setFilter("roeMin", v)}
              placeholder="不限"
              step={1}
            />
            <FilterField
              label="ROE ≤ ( % )"
              value={filters.roeMax}
              onChange={(v) => setFilter("roeMax", v)}
              placeholder="不限"
              step={1}
            />
            <FilterField
              label="安全边际 ≥ ( 分 )"
              value={filters.safetyScoreMin}
              onChange={(v) => setFilter("safetyScoreMin", v)}
              placeholder="不限"
              step={5}
            />
            <FilterField
              label="PB ≤"
              value={filters.pbMax}
              onChange={(v) => setFilter("pbMax", v)}
              placeholder="不限"
              step={0.5}
            />
            <FilterField
              label="负债率 ≤ ( % )"
              value={filters.debtRatioMax}
              onChange={(v) => setFilter("debtRatioMax", v)}
              placeholder="不限"
              step={5}
            />
            <FilterField
              label="综合评分 ≥ ( 分 )"
              value={filters.scoreMin}
              onChange={(v) => setFilter("scoreMin", v)}
              placeholder="不限"
              step={5}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 单筛选字段 ──────────────────────────────────────────────

function FilterField({
  label, value, onChange, placeholder, step = 1,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  step?: number;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>{label}</div>
      <InputNumber
        size="small"
        value={value}
        onChange={(v) => onChange(v ?? null)}
        placeholder={placeholder}
        style={{ width: "100%" }}
        min={0}
        step={step}
        controls={false}
      />
    </div>
  );
}
