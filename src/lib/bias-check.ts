// ============================================================
// src/lib/bias-check.ts — 下单前偏误自检（纯函数，可单测）
// ------------------------------------------------------------
// 来源：Kahneman《思考，快与慢》——书里最反讽的一句是「知道有偏误，
// 并不能消除偏误」（认知错觉）。所以这里不做提醒，做**核对清单**：
//   ① 锚定效应（ch11）     依据是估值，不是成本价 / 近期高点 / 大V喊价
//   ② 叙事谬误（第三部分）  依据是数字，不是讲得通的故事（含护城河文案）
//   ③ 损失厌恶·禀赋效应（ch27）  换成空仓视角，我还会做同样动作吗
//   ④ 过度自信（第三部分）  我能说出反方最强理由吗
// 四项里「否」越多，越应该今天不动手。
// ============================================================

export interface BiasAnswers {
  valuationNotCost: boolean;
  numbersNotStory: boolean;
  wouldActIfFlat: boolean;
  canStateCounter: boolean;
}

export const BIAS_QUESTIONS: Array<{
  key: keyof BiasAnswers;
  question: string;
  /** 答「否」时说明触发了什么偏误 */
  risk: string;
  book: string;
}> = [
  {
    key: "valuationNotCost",
    question: "我的依据是合理估值，而不是成本价 / 前期高点？",
    risk: "锚定效应：成本价是沉没成本，跟它现在贵不贵无关",
    book: "ch11 锚定效应",
  },
  {
    key: "numbersNotStory",
    question: "我的依据是算出来的数字，不是听来的故事？",
    risk: "叙事谬误：故事越顺越像真的，但顺不顺不是证据",
    book: "第三部分 过度自信",
  },
  {
    key: "wouldActIfFlat",
    question: "如果我现在空仓，我还会做同样的动作？",
    risk: "损失厌恶 / 禀赋效应：你会因为「已经拥有」或「不想认亏」而改变判断",
    book: "ch27 禀赋效应",
  },
  {
    key: "canStateCounter",
    question: "我能说出反方最强的理由，而且不是一秒就驳倒它？",
    risk: "过度自信：说得出对手的最强论据，才算真看懂了",
    book: "第三部分 过度自信",
  },
];

export type BiasLevel = "go" | "caution" | "stop";

export interface BiasVerdict {
  level: BiasLevel;
  label: string;
  advice: string;
  /** 答「否」的问题 */
  triggered: Array<{ question: string; risk: string; book: string }>;
}

/**
 * 四问里答「否」的数量决定结论：
 *   0 → 可以做，但把理由写下来（写不下来＝没有理由）
 *   1 → 降一半仓位，或先只做一半
 *   ≥2 → 今天别动，等 24 小时再看
 */
export function biasVerdict(answers: BiasAnswers): BiasVerdict {
  const triggered = BIAS_QUESTIONS.filter((q) => answers[q.key] === false).map((q) => ({
    question: q.question,
    risk: q.risk,
    book: q.book,
  }));
  if (triggered.length === 0) {
    return {
      level: "go",
      label: "四问全过",
      advice: "可以做，但把理由写下来再下单——写不下来的理由等于没有理由。",
      triggered,
    };
  }
  if (triggered.length === 1) {
    return {
      level: "caution",
      label: "1 项不过",
      advice: "降一半仓位，或先只做计划的一半，剩下的等下次确认。",
      triggered,
    };
  }
  return {
    level: "stop",
    label: `${triggered.length} 项不过`,
    advice: "今天别动。等 24 小时再看同一组数字，如果还想做，那时再执行。",
    triggered,
  };
}

// ─── 自动信号：从持仓/估值数据里先看出「高危点」 ────────────────

export interface BiasSignalsInput {
  price: number | null;
  cost: number | null;
  /** 浮亏比例（%），负数表示亏损 */
  profitPct: number | null;
  /** 合理估值（元）；没有就传 null */
  fairValue: number | null;
  /** 是否有护城河叙述文案（LLM 生成）*/
  hasNarrative: boolean;
  /** 当前建议动作文本 */
  action?: string | null;
  /** 可用现金（元），用于判断补仓弹药 */
  cash?: number | null;
  /** 建议现金下限所需金额（元）*/
  cashFloorNeeded?: number | null;
}

export interface BiasSignal {
  kind: "anchor" | "story" | "loss" | "cash";
  text: string;
}

const pctDiff = (a: number, b: number): number => (b === 0 ? 0 : ((a - b) / b) * 100);

/** 自动信号：不替你做判断，只把「容易被偏误影响的点」指出来 */
export function biasSignals(input: BiasSignalsInput): BiasSignal[] {
  const out: BiasSignal[] = [];
  const { price, cost, profitPct, fairValue, hasNarrative, action, cash, cashFloorNeeded } = input;

  // ① 锚定：现价贴着成本价 → 最容易把成本当合理价
  if (price != null && cost != null && cost > 0) {
    const d = pctDiff(price, cost);
    if (Math.abs(d) < 3) {
      out.push({
        kind: "anchor",
        text: `现价距成本价仅 ${d >= 0 ? "+" : ""}${d.toFixed(1)}%——这个位置最容易把「回本」当成卖出理由，先看合理估值。`,
      });
    }
  }

  // ① 锚定（另一种）：现价贴近合理估值但判断依据写着成本
  if (price != null && fairValue != null && fairValue > 0 && cost != null) {
    const premium = pctDiff(price, fairValue);
    const costGap = pctDiff(price, cost);
    if (Math.abs(premium) < 5 && Math.abs(costGap) > 15) {
      out.push({
        kind: "anchor",
        text: `现价离合理估值只有 ${premium.toFixed(1)}%，但离你的成本价有 ${costGap.toFixed(1)}%——两个参照点会打架，以估值那个为准。`,
      });
    }
  }

  // ② 叙事：有 LLM 生成的护城河文案 → 提醒它讲得顺不代表真
  if (hasNarrative) {
    out.push({
      kind: "story",
      text: "这只票的护城河描述是模型生成的叙述：读起来越顺越要警惕叙事谬误，回到 ROIC/毛利率/现金流的数字上核对。",
    });
  }

  // ③ 损失厌恶：浮亏较深且涉及卖出/补仓动作
  if (profitPct != null && profitPct < -10 && action) {
    const acts = /卖出|减仓|止盈|补仓|加仓/.exec(action);
    if (acts) {
      out.push({
        kind: "loss",
        text: `当前浮亏 ${profitPct.toFixed(1)}%，而这笔动作是「${acts[0]}」——先确认这是估值判断，不是不想认亏（或急着摊平）。`,
      });
    }
  }

  // ④ 弹药：现金不足时的补仓冲动
  if (
    cash != null && cashFloorNeeded != null &&
    cashFloorNeeded > 0 && cash < cashFloorNeeded && action && /补仓|加仓/.test(action)
  ) {
    out.push({
      kind: "cash",
      text: "现金低于建议下限还要补仓：这会把仓位打得更满，真跌下去就没有第二次机会了。",
    });
  }

  return out;
}

export const SIGNAL_COLOR: Record<BiasSignal["kind"], string> = {
  anchor: "gold",
  story: "purple",
  loss: "red",
  cash: "blue",
};

export const SIGNAL_LABEL: Record<BiasSignal["kind"], string> = {
  anchor: "锚定",
  story: "叙事",
  loss: "损失厌恶",
  cash: "弹药",
};
