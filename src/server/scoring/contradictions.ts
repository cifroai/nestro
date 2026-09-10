import { round3 } from './round.js';
import type { CompetencyScore } from './types.js';

/**
 * Проверка согласованности (§22): расхождение между декларируемым конструктом
 * и решениями в ситуационных кейсах.
 *
 * Формулировки вида «кандидат лжёт» / «неискренен» недопустимы — только
 * «потенциальное расхождение».
 */

export interface Declaration {
  constructId: string;
  /** Текстовые полюса конструкта — попадают в описание расхождения. */
  poleLeft: string;
  poleRight: string;
  /** Компетенция, с которой сопоставлен конструкт. */
  competencyCode: string;
  /** Ранг значимости конструкта для кандидата (1 — самый значимый). */
  importanceRank: number;
  /** Ответы, из которых выведена декларация. */
  sourceAnswerIds: string[];
}

export interface Contradiction {
  constructId: string | null;
  competencyCode: string;
  answerIds: string[];
  description: string;
  strength: number;
}

export const CONTRADICTION_PREFIX =
  'Потенциальное расхождение между декларируемым конструктом и решениями в кейсах';

const TOP_RANK_LIMIT = 5;
const LOW_SCORE_THRESHOLD = 2.0;

/**
 * Если конструкт входит в топ-5 по значимости для кандидата, а балл
 * соответствующей компетенции по кейсам не превышает 2.0 — фиксируется
 * расхождение с силой (2.0 − score) / 2.0.
 */
export function detectCrossAnswerContradictions(
  declarations: Declaration[],
  scores: CompetencyScore[],
): Contradiction[] {
  const byCode = new Map(scores.map((s) => [s.competencyCode, s]));
  const result: Contradiction[] = [];

  for (const decl of declarations) {
    if (decl.importanceRank > TOP_RANK_LIMIT) continue;
    const score = byCode.get(decl.competencyCode);
    if (!score || score.notEnoughEvidence || score.score0to4 === null) continue;
    if (score.score0to4 > LOW_SCORE_THRESHOLD) continue;

    const strength = round3((LOW_SCORE_THRESHOLD - score.score0to4) / LOW_SCORE_THRESHOLD);
    result.push({
      constructId: decl.constructId,
      competencyCode: decl.competencyCode,
      answerIds: [...decl.sourceAnswerIds],
      description:
        `${CONTRADICTION_PREFIX}. Конструкт «${decl.poleLeft} ↔ ${decl.poleRight}» отнесён кандидатом ` +
        `к наиболее значимым (ранг ${decl.importanceRank}), однако по компетенции ${decl.competencyCode} ` +
        `решения в кейсах соответствуют уровню ${score.score0to4.toFixed(2)} из 4.`,
      strength,
    });
  }

  return result.sort((a, b) => b.strength - a.strength);
}
