import {
  DEFAULT_SCORING_PARAMS,
  NOT_ENOUGH_EVIDENCE,
  type AnswerScoreInput,
  type AssessmentScore,
  type AxisCode,
  type AxisScore,
  type BandCode,
  type BandThresholds,
  type Combined,
  type CompetencyConfig,
  type CompetencyScore,
  type CriticalGap,
  type Effective,
  type HumanReviewInput,
  type Judgement,
  type ScoringParams,
} from './types.js';
import { clamp, clamp01, mean, round3, stdev } from './round.js';

const isNee = (v: number | typeof NOT_ENOUGH_EVIDENCE): v is typeof NOT_ENOUGH_EVIDENCE =>
  v === NOT_ENOUGH_EVIDENCE;

/**
 * Шаг 1 — объединение двух независимых оценщиков (docs/SCORING.md §3).
 * Асимметрия доказательств (один оценщик нашёл, другой нет) сама по себе
 * является поводом для экспертной проверки.
 */
export function combineEvaluators(
  a: Judgement | null,
  b: Judgement | null,
  threshold: number = DEFAULT_SCORING_PARAMS.disagreementThreshold,
): Combined {
  if (!a && !b) {
    return {
      score: NOT_ENOUGH_EVIDENCE,
      agreement: null,
      modelConfidence: 0,
      reviewRequired: true,
      disagreementDelta: null,
    };
  }

  const single = !a || !b;
  if (single) {
    const only = (a ?? b) as Judgement;
    return {
      score: only.score,
      agreement: null,
      modelConfidence: clamp01(only.confidence),
      reviewRequired: isNee(only.score),
      disagreementDelta: null,
    };
  }

  const aNee = isNee(a.score);
  const bNee = isNee(b.score);

  if (aNee && bNee) {
    return {
      score: NOT_ENOUGH_EVIDENCE,
      agreement: 1,
      modelConfidence: clamp01(mean([a.confidence, b.confidence])),
      reviewRequired: false,
      disagreementDelta: null,
    };
  }

  if (aNee !== bNee) {
    const present = (aNee ? b.score : a.score) as number;
    return {
      score: present,
      agreement: 0.5,
      modelConfidence: clamp01(mean([a.confidence, b.confidence])),
      reviewRequired: true,
      disagreementDelta: null,
    };
  }

  const sa = a.score as number;
  const sb = b.score as number;
  const delta = Math.abs(sa - sb);
  return {
    score: round3((sa + sb) / 2),
    agreement: round3(1 - delta / 4),
    modelConfidence: clamp01(mean([a.confidence, b.confidence])),
    reviewRequired: delta >= threshold,
    disagreementDelta: round3(delta),
  };
}

/** Шаг 2 — экспертная корректировка (docs/SCORING.md §4). */
export function applyHumanReview(combined: Combined, review: HumanReviewInput | null): Effective {
  if (!review) {
    return {
      score: combined.score,
      agreement: combined.agreement,
      modelScore: combined.score,
      humanReviewed: false,
      reviewRequired: combined.reviewRequired,
    };
  }
  if (review.markedUninformative) {
    return {
      score: NOT_ENOUGH_EVIDENCE,
      agreement: combined.agreement,
      modelScore: combined.score,
      humanReviewed: true,
      reviewRequired: false,
    };
  }
  return {
    score: review.humanScore === null ? NOT_ENOUGH_EVIDENCE : clamp(review.humanScore, 0, 4),
    agreement: combined.agreement,
    modelScore: combined.score,
    humanReviewed: true,
    reviewRequired: false,
  };
}

/** Качество доказательства ответа: q ∈ [0.5, 1.0] (docs/SCORING.md §5). */
function evidenceQualityFactor(supportingEvidenceCount: number): number {
  const quality = Math.min(1, supportingEvidenceCount / 2);
  return clamp(0.5 + 0.5 * quality, 0.5, 1);
}

interface ScoredInput {
  input: AnswerScoreInput;
  score: number;
  weight: number;
}

function scoredInputs(inputs: AnswerScoreInput[]): ScoredInput[] {
  const result: ScoredInput[] = [];
  for (const input of inputs) {
    if (isNee(input.effective.score)) continue;
    const q = evidenceQualityFactor(input.supportingEvidenceCount);
    result.push({ input, score: input.effective.score, weight: input.weight * q });
  }
  return result;
}

/** Шаг 4 — confidence (docs/SCORING.md §6). Отделён от балла (§64). */
export function calculateConfidence(
  inputs: AnswerScoreInput[],
  cfg: CompetencyConfig,
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
): number {
  const scored = scoredInputs(inputs);
  if (scored.length === 0) return 0;

  const w = params.confidenceWeights;
  const totalEvidence = scored.reduce((acc, s) => acc + s.input.supportingEvidenceCount, 0);
  const sEvidence = Math.min(1, totalEvidence / Math.max(1, cfg.minEvidenceCount));

  const agreements = scored
    .map((s) => s.input.effective.agreement)
    .filter((a): a is number => a !== null);
  const sAgreement = agreements.length ? mean(agreements) : params.neutralAgreement;

  const values = scored.map((s) => s.score);
  const sConsistency = values.length < 2 ? params.neutralAgreement : 1 - Math.min(1, stdev(values) / 1.5);

  const distinctQuestions = new Set(scored.map((s) => s.input.questionVersionId)).size;
  const sCoverage = Math.min(1, distinctQuestions / Math.max(1, cfg.minQuestionCount));

  const sHuman = scored.some((s) => s.input.effective.humanReviewed) ? 1 : 0;

  return round3(
    clamp01(
      w.evidence * sEvidence +
        w.agreement * sAgreement +
        w.consistency * sConsistency +
        w.coverage * sCoverage +
        w.human * sHuman,
    ),
  );
}

/** Шаг 3 — балл компетенции (docs/SCORING.md §5). */
export function calculateCompetencyScore(
  inputs: AnswerScoreInput[],
  cfg: CompetencyConfig,
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
): CompetencyScore {
  const scored = scoredInputs(inputs);
  const humanReviewedCount = inputs.filter((i) => i.effective.humanReviewed).length;
  const reviewRequired = inputs.some((i) => i.effective.reviewRequired);
  const evidenceCount = scored.reduce((acc, s) => acc + s.input.supportingEvidenceCount, 0);

  if (scored.length === 0) {
    return {
      competencyCode: cfg.competencyCode,
      weight: cfg.weight,
      score0to4: null,
      score0to100: null,
      level: null,
      confidence: 0,
      evidenceCount: 0,
      questionCount: 0,
      notEnoughEvidence: true,
      humanReviewedCount,
      reviewRequired,
      isHardGate: cfg.isHardGate,
    };
  }

  const weightSum = scored.reduce((acc, s) => acc + s.weight, 0);
  const weighted = scored.reduce((acc, s) => acc + s.weight * s.score, 0);
  const score0to4 = weightSum > 0 ? round3(weighted / weightSum) : null;

  return {
    competencyCode: cfg.competencyCode,
    weight: cfg.weight,
    score0to4,
    score0to100: score0to4 === null ? null : round3((score0to4 / 4) * 100),
    level: score0to4 === null ? null : Math.floor(score0to4 + 0.5),
    confidence: calculateConfidence(inputs, cfg, params),
    evidenceCount,
    questionCount: new Set(scored.map((s) => s.input.questionVersionId)).size,
    notEnoughEvidence: false,
    humanReviewedCount,
    reviewRequired,
    isHardGate: cfg.isHardGate,
  };
}

/** Восемь агрегированных осей профиля (docs/SCORING.md §8). */
export type AxisMap = Record<string, AxisCode>;

export function calculateAxisScores(scores: CompetencyScore[], map: AxisMap): AxisScore[] {
  const byAxis = new Map<AxisCode, CompetencyScore[]>();
  for (const score of scores) {
    const axis = map[score.competencyCode];
    if (!axis) continue;
    const bucket = byAxis.get(axis);
    if (bucket) bucket.push(score);
    else byAxis.set(axis, [score]);
  }

  const result: AxisScore[] = [];
  for (const [axis, members] of [...byAxis.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const scoredMembers = members.filter((m) => !m.notEnoughEvidence && m.score0to4 !== null);
    const competencyCodes = members.map((m) => m.competencyCode).sort();
    if (scoredMembers.length === 0) {
      result.push({
        axis,
        score0to4: null,
        score0to100: null,
        level: null,
        confidence: 0,
        notEnoughEvidence: true,
        competencyCodes,
      });
      continue;
    }
    const weightSum = scoredMembers.reduce((acc, m) => acc + m.weight, 0);
    const value =
      weightSum > 0
        ? scoredMembers.reduce((acc, m) => acc + m.weight * (m.score0to4 as number), 0) / weightSum
        : mean(scoredMembers.map((m) => m.score0to4 as number));
    const conf =
      weightSum > 0
        ? scoredMembers.reduce((acc, m) => acc + m.weight * m.confidence, 0) / weightSum
        : mean(scoredMembers.map((m) => m.confidence));
    const score0to4 = round3(value);
    result.push({
      axis,
      score0to4,
      score0to100: round3((score0to4 / 4) * 100),
      level: Math.floor(score0to4 + 0.5),
      confidence: round3(clamp01(conf)),
      notEnoughEvidence: false,
      competencyCodes,
    });
  }
  return result;
}

export function resolveBand(
  overall: number | null,
  coverage: number,
  thresholds: BandThresholds,
  minCoverage: number = DEFAULT_SCORING_PARAMS.minCoverage,
): BandCode {
  if (overall === null || coverage < minCoverage) return 'INSUFFICIENT_DATA';
  if (overall >= thresholds.EXPERT) return 'EXPERT';
  if (overall >= thresholds.HIGH) return 'HIGH';
  if (overall >= thresholds.SUFFICIENT) return 'SUFFICIENT';
  if (overall >= thresholds.GAPS) return 'GAPS';
  return 'NOT_CONFIRMED';
}

/** Шаг 5 — Overall Professional Score с перенормировкой по покрытию (§7). */
export function calculateAssessmentScore(
  scores: CompetencyScore[],
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
): AssessmentScore {
  const totalWeight = scores.reduce((acc, s) => acc + s.weight, 0);
  const withData = scores.filter((s) => !s.notEnoughEvidence && s.score0to100 !== null);
  const dataWeight = withData.reduce((acc, s) => acc + s.weight, 0);

  if (totalWeight <= 0 || withData.length === 0 || dataWeight <= 0) {
    return {
      overall0to100: null,
      overall0to4: null,
      confidence: 0,
      coverage: 0,
      band: 'INSUFFICIENT_DATA',
      insufficientData: true,
      scoredCompetencies: 0,
      totalCompetencies: scores.length,
    };
  }

  const coverage = round3(dataWeight / totalWeight);
  const overall = round3(
    withData.reduce((acc, s) => acc + (s.weight / dataWeight) * (s.score0to100 as number), 0),
  );
  const confidence = round3(
    clamp01(withData.reduce((acc, s) => acc + (s.weight / dataWeight) * s.confidence, 0) * coverage),
  );
  const insufficientData = coverage < params.minCoverage;

  return {
    overall0to100: overall,
    overall0to4: round3((overall / 100) * 4),
    confidence,
    coverage,
    band: resolveBand(overall, coverage, params.bandThresholds, params.minCoverage),
    insufficientData,
    scoredCompetencies: withData.length,
    totalCompetencies: scores.length,
  };
}

/**
 * Hard-gates (§19). Никогда не отклоняют кандидата — только требуют
 * дополнительной проверки.
 */
export function detectCriticalGaps(
  scores: CompetencyScore[],
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
): CriticalGap[] {
  const gaps: CriticalGap[] = [];
  for (const score of scores) {
    if (!score.isHardGate) continue;
    if (score.notEnoughEvidence || score.score0to4 === null) {
      gaps.push({
        competencyCode: score.competencyCode,
        status: 'REQUIRES_ADDITIONAL_CHECK',
        reason: 'NOT_ENOUGH_EVIDENCE',
        score0to4: null,
        message: 'Критическая компетенция требует дополнительной проверки',
      });
      continue;
    }
    if (score.score0to4 < params.gateThreshold) {
      gaps.push({
        competencyCode: score.competencyCode,
        status: 'REQUIRES_ADDITIONAL_CHECK',
        reason: 'BELOW_THRESHOLD',
        score0to4: score.score0to4,
        message: 'Критическая компетенция требует дополнительной проверки',
      });
    }
  }
  return gaps;
}

export const CONFIDENCE_LABELS = {
  HIGH: 'высокая',
  MEDIUM: 'средняя',
  LOW: 'низкая, требуется проверка',
} as const;

/** Текстовая интерпретация confidence. Не является оценкой квалификации (§64). */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return CONFIDENCE_LABELS.HIGH;
  if (confidence >= 0.5) return CONFIDENCE_LABELS.MEDIUM;
  return CONFIDENCE_LABELS.LOW;
}

export const LEVEL_TITLES: Record<number, string> = {
  0: 'отсутствует',
  1: 'декларативный',
  2: 'операционный',
  3: 'системный',
  4: 'экспертный',
};

export const BAND_TITLES: Record<BandCode, string> = {
  EXPERT: 'выраженный экспертный уровень',
  HIGH: 'высокий профессиональный уровень',
  SUFFICIENT: 'достаточный / требует проверки отдельных компетенций',
  GAPS: 'имеются существенные квалификационные пробелы',
  NOT_CONFIRMED: 'текущие ответы не подтверждают требуемый уровень',
  INSUFFICIENT_DATA: 'недостаточно данных',
};
