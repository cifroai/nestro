/**
 * Типы модуля скоринга. Намеренно не содержат Prisma-типов и персональных
 * данных: скоринг не имеет доступа к PII (docs/SECURITY.md §8) и остаётся
 * детерминированным (docs/SCORING.md).
 */

/** Специальное значение «недостаточно данных» (§65). Не заменяется нулём. */
export const NOT_ENOUGH_EVIDENCE = 'NOT_ENOUGH_EVIDENCE' as const;
export type NotEnoughEvidence = typeof NOT_ENOUGH_EVIDENCE;

/** Суждение одного оценщика по одной компетенции в одном ответе. */
export interface Judgement {
  score: number | NotEnoughEvidence;
  confidence: number;
}

export interface Combined {
  score: number | NotEnoughEvidence;
  /** Согласованность оценщиков 0..1; null — второй оценщик не участвовал. */
  agreement: number | null;
  modelConfidence: number;
  reviewRequired: boolean;
  disagreementDelta: number | null;
}

export interface HumanReviewInput {
  humanScore: number | null;
  markedUninformative: boolean;
}

export interface Effective {
  score: number | NotEnoughEvidence;
  agreement: number | null;
  modelScore: number | NotEnoughEvidence;
  humanReviewed: boolean;
  reviewRequired: boolean;
}

/** Вклад одного ответа в компетенцию. */
export interface AnswerScoreInput {
  answerId: string;
  questionVersionId: string;
  /** Вес вопроса внутри компетенции (QuestionCompetency.weightWithinCompetency). */
  weight: number;
  /** Число подтверждённых доказательств (проверенных цитат). */
  supportingEvidenceCount: number;
  effective: Effective;
}

export interface CompetencyConfig {
  competencyCode: string;
  /** AssessmentCompetency.weight, проценты. */
  weight: number;
  isHardGate: boolean;
  minEvidenceCount: number;
  minQuestionCount: number;
}

export interface CompetencyScore {
  competencyCode: string;
  weight: number;
  score0to4: number | null;
  score0to100: number | null;
  level: number | null;
  confidence: number;
  evidenceCount: number;
  questionCount: number;
  notEnoughEvidence: boolean;
  humanReviewedCount: number;
  reviewRequired: boolean;
  isHardGate: boolean;
}

export type AxisCode =
  | 'TECHNICAL_REASONING'
  | 'SYSTEM_THINKING'
  | 'RISK_MANAGEMENT'
  | 'PREVENTIVE_THINKING'
  | 'DECISION_MAKING'
  | 'OPERATIONAL_MATURITY'
  | 'COMMUNICATION'
  | 'SELF_AWARENESS';

export interface AxisScore {
  axis: AxisCode;
  score0to4: number | null;
  score0to100: number | null;
  level: number | null;
  confidence: number;
  notEnoughEvidence: boolean;
  competencyCodes: string[];
}

export type BandCode =
  | 'EXPERT'
  | 'HIGH'
  | 'SUFFICIENT'
  | 'GAPS'
  | 'NOT_CONFIRMED'
  | 'INSUFFICIENT_DATA';

export interface BandThresholds {
  EXPERT: number;
  HIGH: number;
  SUFFICIENT: number;
  GAPS: number;
}

export const DEFAULT_BAND_THRESHOLDS: BandThresholds = {
  EXPERT: 85,
  HIGH: 70,
  SUFFICIENT: 55,
  GAPS: 40,
};

export interface AssessmentScore {
  overall0to100: number | null;
  overall0to4: number | null;
  confidence: number;
  /** Доля веса компетенций, по которым есть данные. */
  coverage: number;
  band: BandCode;
  insufficientData: boolean;
  scoredCompetencies: number;
  totalCompetencies: number;
}

export interface CriticalGap {
  competencyCode: string;
  status: 'REQUIRES_ADDITIONAL_CHECK';
  reason: 'BELOW_THRESHOLD' | 'NOT_ENOUGH_EVIDENCE';
  score0to4: number | null;
  /** Нейтральная формулировка (§19): hard-gate не отклоняет кандидата. */
  message: string;
}

export interface ScoringParams {
  /** Порог расхождения оценщиков, при котором требуется human review (§16). */
  disagreementThreshold: number;
  /** Порог hard-gate по шкале 0..4 (§19). */
  gateThreshold: number;
  /** Минимальное покрытие весов данными; ниже — «Недостаточно данных» (§18). */
  minCoverage: number;
  bandThresholds: BandThresholds;
  /** Веса компонентов confidence (docs/SCORING.md §6). */
  confidenceWeights: {
    evidence: number;
    agreement: number;
    consistency: number;
    coverage: number;
    human: number;
  };
  /** Нейтральное значение согласованности при единственном оценщике. */
  neutralAgreement: number;
}

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  disagreementThreshold: 1.0,
  gateThreshold: 2.0,
  minCoverage: 0.6,
  bandThresholds: DEFAULT_BAND_THRESHOLDS,
  confidenceWeights: { evidence: 0.35, agreement: 0.25, consistency: 0.2, coverage: 0.1, human: 0.1 },
  neutralAgreement: 0.6,
};
