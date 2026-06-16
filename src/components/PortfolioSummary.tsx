// ============================================================
// PortfolioSummary.tsx — E. 组合收益总览
// ============================================================

"use client";

import { Card, Flex, Typography, Statistic, Row, Col, Empty, Tooltip } from "antd";
import {
  WalletOutlined, RiseOutlined, GiftOutlined, FundOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import type { StockData } from "@/lib/types";
import { usePortfolio } from "@/hooks/usePortfolio";

const { Text } = Typography;

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--";

const fmtPct = (v: number | null | undefined): string =>
  v != null ? (v > 0 ? "+" : "") + v.toFixed(2) + "%" : "--";

interface PortfolioSummaryProps {
  stockDataMap: Map<string, StockData>;
}

export default function PortfolioSummary({ stockDataMap }: PortfolioSummaryProps) {
  const { positions, metrics, summary } = usePortfolio(stockDataMap);

  if (positions.length === 0) {
    return null; // 无持仓不显示
  }

  // 计算年化分红收入（基于当前股息率和持仓）
  let annualDividendIncome = 0;
  for (const pos of positions) {
    const sd = stockDataMap.get(pos.stockCode);
    const yield_ = sd?.fundamentals.dividendYield;
    const currentPrice = sd?.quote.currentPrice ?? pos.buyPrice;
    const marketValue = pos.shares * currentPrice;
    if (yield_ != null && yield_ > 0) {
      annualDividendIncome += marketValue * (yield_ / 100);
    }
  }

  const dividendYieldOnCost = summary.totalInvested > 0
    ? (annualDividendIncome / summary.totalInvested) * 100
    : 0;

  // 平均持仓年数
  const avgYears = positions.length > 0
    ? positions.reduce((sum, p) => {
        const buyDate = new Date(p.buyDate);
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        return sum + years;
      }, 0) / positions.length
    : 0;

  return (
    <Card
      size="small"
      styles={{ body: { padding: 16 } }}
      style={{ boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.08)" }}
      title={
        <Flex align="center" gap={8}>
          <FundOutlined />
          <span style={{ fontWeight: 600 }}>组合收益总览</span>
        </Flex>
      }
    >
      {/* 核心指标 */}
      <Row gutter={[16, 12]}>
        <Col span={6}>
          <Statistic
            title={
              <span>
                总投入
                <Tooltip title="全部持仓累计投入金额（含手续费）"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={summary.totalInvested}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 18, fontWeight: 600 }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="当前市值"
            value={summary.totalMarketValue}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 18, fontWeight: 600 }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={
              <span>
                累计分红
                <Tooltip title="已到账分红合计"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={summary.totalDividends}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 18, fontWeight: 600, color: "#16a34a" }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="总盈亏"
            value={summary.totalProfit}
            prefix={summary.totalProfit >= 0 ? "+" : ""}
            suffix={summary.totalProfitPct !== 0 ? `(${fmtPct(summary.totalProfitPct)})` : ""}
            precision={2}
            valueStyle={{
              fontSize: 18, fontWeight: 600,
              color: summary.totalProfit > 0 ? "#ef4444" : summary.totalProfit < 0 ? "#22c55e" : "#9ca3af",
            }}
          />
        </Col>
      </Row>

      {/* 扩展指标 */}
      <Row gutter={[16, 12]} style={{ marginTop: 8 }}>
        <Col span={6}>
          <Statistic
            title={
              <span>
                年化分红收入
                <Tooltip title="基于当前持仓市值 × 最新股息率估算"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={annualDividendIncome}
            prefix="¥"
            precision={2}
            valueStyle={{ fontSize: 16, color: "#2563eb" }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={
              <span>
                分红市值收益率
                <Tooltip title="年化分红 ÷ 当前市值"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={summary.totalMarketValue > 0
              ? (annualDividendIncome / summary.totalMarketValue) * 100
              : 0}
            suffix="%"
            precision={2}
            valueStyle={{
              fontSize: 16,
              color: summary.totalMarketValue > 0 && (annualDividendIncome / summary.totalMarketValue) > 0.05
                ? "#16a34a" : "#6b7280",
            }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={
              <span>
                分红投入收益率
                <Tooltip title="年化分红 ÷ 总投入，衡量原始投入的现金回报率"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={dividendYieldOnCost}
            suffix="%"
            precision={2}
            valueStyle={{
              fontSize: 16,
              color: dividendYieldOnCost > 8 ? "#16a34a" : dividendYieldOnCost > 5 ? "#2563eb" : "#6b7280",
              fontWeight: dividendYieldOnCost > 8 ? 700 : 400,
            }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={
              <span>
                平均持仓年数
                <Tooltip title="所有持仓持有时间的平均值"><InfoCircleOutlined style={{ marginLeft: 4, fontSize: 11, cursor: "help" }} /></Tooltip>
              </span>
            }
            value={avgYears}
            suffix="年"
            precision={1}
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
        共 {positions.length} 只持仓 · {
          summary.totalDividends > 0
            ? `已通过分红收回 ${((summary.totalDividends / summary.totalInvested) * 100).toFixed(1)}% 的本金`
            : "暂无分红记录"
        }
      </div>
    </Card>
  );
}
