import { round3 } from '../scoring/round.js';
import type { GridMetrics } from './grid.js';

/**
 * Лестница смыслов (docs/KELLY_METHOD.md §6).
 * Глубина жёстко ограничена: бесконечное рекурсивное интервью невозможно.
 */
export const MAX_LADDER_DEPTH = 5;
export const MIN_LADDER_DEPTH = 3;
export const LADDER_QUESTION = 'Почему для вас это важно?';

const SHORT_ANSWER_CHARS = 30;
const SHORT_ANSWER_STREAK_LIMIT = 2;

export interface LadderSelectionInput {
  constructId: string;
  /** Ранг значимости, заданный самим кандидатом (1 — самый значимый). */
  candidateImportanceRank: number | null;
  discriminationPower: number;
  selfIdealDistance: number;
}

export interface LadderSelection {
  constructId: string;
  significance: number;
}

/**
 * significance = 0.5·discrimination + 0.3·selfIdealDistance + 0.2·importanceRank
 * (docs/KELLY_METHOD.md §6). Детерминированно: одинаковый вход — одинаковый выход.
 */
export function selectLadderConstructs(
  inputs: LadderSelectionInput[],
  count: number,
): LadderSelection[] {
  const total = inputs.length;
  const scored = inputs.map((input) => {
    const rankScore =
      input.candidateImportanceRank && total > 1
        ? (total - input.candidateImportanceRank) / (total - 1)
        : 0;
    return {
      constructId: input.constructId,
      significance: round3(
        0.5 * input.discriminationPower + 0.3 * input.selfIdealDistance + 0.2 * rankScore,
      ),
    };
  });

  return scored
    .sort((a, b) =>
      b.significance !== a.significance
        ? b.significance - a.significance
        : a.constructId.localeCompare(b.constructId),
    )
    .slice(0, Math.max(0, Math.min(count, scored.length)));
}

export function selectFromGridMetrics(
  metrics: GridMetrics,
  importanceRanks: Map<string, number | null>,
  count: number,
): LadderSelection[] {
  return selectLadderConstructs(
    metrics.constructSignificance.map((s) => ({
      constructId: s.constructId,
      candidateImportanceRank: importanceRanks.get(s.constructId) ?? null,
      discriminationPower: s.discriminationPower,
      selfIdealDistance: s.selfIdealDistance,
    })),
    count,
  );
}

export interface LadderStepSnapshot {
  depth: number;
  answer: string;
}

export interface LadderContinuation {
  shouldContinue: boolean;
  nextDepth: number | null;
  question: string | null;
  terminatedEarly: boolean;
  reason: 'MAX_DEPTH' | 'SHORT_ANSWERS' | 'CONTINUE';
}

/**
 * Решение о продолжении лестницы. Останов раньше MIN_LADDER_DEPTH при двух
 * коротких ответах подряд фиксируется как terminatedEarly, а не как ошибка.
 */
export function nextLadderStep(
  steps: LadderStepSnapshot[],
  maxDepth: number = MAX_LADDER_DEPTH,
): LadderContinuation {
  const depth = steps.length;
  const cappedMax = Math.min(maxDepth, MAX_LADDER_DEPTH);

  if (depth >= cappedMax) {
    return { shouldContinue: false, nextDepth: null, question: null, terminatedEarly: false, reason: 'MAX_DEPTH' };
  }

  const tail = steps.slice(-SHORT_ANSWER_STREAK_LIMIT);
  const allShort =
    tail.length === SHORT_ANSWER_STREAK_LIMIT &&
    tail.every((s) => s.answer.trim().length < SHORT_ANSWER_CHARS);
  if (allShort) {
    return {
      shouldContinue: false,
      nextDepth: null,
      question: null,
      terminatedEarly: depth < MIN_LADDER_DEPTH,
      reason: 'SHORT_ANSWERS',
    };
  }

  return {
    shouldContinue: true,
    nextDepth: depth + 1,
    question: LADDER_QUESTION,
    terminatedEarly: false,
    reason: 'CONTINUE',
  };
}

/**
 * Классификация достигнутого уровня цепочки смыслов:
 * показатель → действие → риск → результат строительства скважины.
 */
export type LadderTerminalTag = 'METRIC' | 'ACTION' | 'RISK' | 'WELL_OUTCOME';

const TAG_PATTERNS: Array<{ tag: LadderTerminalTag; markers: string[] }> = [
  {
    tag: 'WELL_OUTCOME',
    markers: [
      'строительств', 'скважин', 'сроки', 'результат проекта', 'коммерческ',
      'сдача', 'заказчик', 'стоимость строительства', 'нпв', 'непроизводительн',
    ],
  },
  {
    tag: 'RISK',
    markers: ['риск', 'осложнен', 'авари', 'прихват', 'поглощен', 'потер', 'безопасн', 'последств'],
  },
  {
    tag: 'ACTION',
    markers: ['обработ', 'скорректир', 'промывк', 'изменить', 'принять решение', 'действ', 'мероприят'],
  },
  { tag: 'METRIC', markers: ['параметр', 'показател', 'значен', 'плотност', 'вязкост', 'замер'] },
];

/** Наивысший достигнутый уровень цепочки по всем ответам лестницы. */
export function classifyLadderTerminal(answers: string[]): LadderTerminalTag | null {
  const haystack = answers.join(' ').toLowerCase().replace(/ё/g, 'е');
  for (const { tag, markers } of TAG_PATTERNS) {
    if (markers.some((m) => haystack.includes(m))) return tag;
  }
  return null;
}
