import { describe, expect, it } from 'vitest';
import {
  applyHumanReview,
  calculateAssessmentScore,
  calculateAxisScores,
  calculateCompetencyScore,
  calculateConfidence,
  combineEvaluators,
  detectCriticalGaps,
  resolveBand,
  DEFAULT_BAND_THRESHOLDS,
  DEFAULT_SCORING_PARAMS,
  NOT_ENOUGH_EVIDENCE,
  type AnswerScoreInput,
  type CompetencyConfig,
  type CompetencyScore,
} from '@/server/scoring/index.js';

const cfg = (over: Partial<CompetencyConfig> = {}): CompetencyConfig => ({
  competencyCode: 'CAUSAL',
  weight: 15,
  isHardGate: false,
  minEvidenceCount: 4,
  minQuestionCount: 3,
  ...over,
});

const answer = (over: Partial<AnswerScoreInput> = {}): AnswerScoreInput => ({
  answerId: 'a1',
  questionVersionId: 'q1',
  weight: 1,
  supportingEvidenceCount: 2,
  effective: {
    score: 3,
    agreement: 1,
    modelScore: 3,
    humanReviewed: false,
    reviewRequired: false,
  },
  ...over,
});

describe('combineEvaluators', () => {
  it('усредняет согласные оценки и не требует проверки', () => {
    const c = combineEvaluators({ score: 3, confidence: 0.8 }, { score: 3, confidence: 0.7 }, 1);
    expect(c.score).toBe(3);
    expect(c.agreement).toBe(1);
    expect(c.reviewRequired).toBe(false);
    expect(c.disagreementDelta).toBe(0);
  });

  it('требует human review при расхождении >= порога', () => {
    const c = combineEvaluators({ score: 1, confidence: 0.6 }, { score: 3, confidence: 0.6 }, 1);
    expect(c.score).toBe(2);
    expect(c.agreement).toBe(0.5);
    expect(c.reviewRequired).toBe(true);
    expect(c.disagreementDelta).toBe(2);
  });

  it('не требует проверки при расхождении ниже порога', () => {
    const c = combineEvaluators({ score: 2, confidence: 0.6 }, { score: 2.5, confidence: 0.6 }, 1);
    expect(c.reviewRequired).toBe(false);
    expect(c.score).toBe(2.25);
  });

  it('асимметрия доказательств (один NEE) требует проверки и сохраняет балл', () => {
    const c = combineEvaluators(
      { score: NOT_ENOUGH_EVIDENCE, confidence: 0.3 },
      { score: 3, confidence: 0.8 },
      1,
    );
    expect(c.score).toBe(3);
    expect(c.agreement).toBe(0.5);
    expect(c.reviewRequired).toBe(true);
  });

  it('оба NEE — остаётся NOT_ENOUGH_EVIDENCE, а не ноль', () => {
    const c = combineEvaluators(
      { score: NOT_ENOUGH_EVIDENCE, confidence: 0.2 },
      { score: NOT_ENOUGH_EVIDENCE, confidence: 0.2 },
      1,
    );
    expect(c.score).toBe(NOT_ENOUGH_EVIDENCE);
    expect(c.score).not.toBe(0);
  });

  it('отсутствие обоих оценщиков требует проверки', () => {
    const c = combineEvaluators(null, null, 1);
    expect(c.score).toBe(NOT_ENOUGH_EVIDENCE);
    expect(c.reviewRequired).toBe(true);
  });

  it('единственный оценщик не даёт согласованности', () => {
    const c = combineEvaluators({ score: 2, confidence: 0.5 }, null, 1);
    expect(c.agreement).toBeNull();
    expect(c.score).toBe(2);
  });
});

describe('applyHumanReview', () => {
  it('экспертная оценка перекрывает модельную и снимает флаг проверки', () => {
    const combined = combineEvaluators({ score: 1, confidence: 0.5 }, { score: 3, confidence: 0.5 }, 1);
    const eff = applyHumanReview(combined, { humanScore: 3, markedUninformative: false });
    expect(eff.score).toBe(3);
    expect(eff.modelScore).toBe(2);
    expect(eff.humanReviewed).toBe(true);
    expect(eff.reviewRequired).toBe(false);
  });

  it('пометка «недостаточно информативно» даёт NEE, а не ноль', () => {
    const combined = combineEvaluators({ score: 2, confidence: 0.5 }, null, 1);
    const eff = applyHumanReview(combined, { humanScore: null, markedUninformative: true });
    expect(eff.score).toBe(NOT_ENOUGH_EVIDENCE);
  });

  it('без review сохраняет модельный результат', () => {
    const combined = combineEvaluators({ score: 2, confidence: 0.5 }, { score: 2, confidence: 0.5 }, 1);
    expect(applyHumanReview(combined, null).humanReviewed).toBe(false);
  });
});

describe('calculateCompetencyScore', () => {
  it('взвешивает ответы по весу вопроса и качеству доказательств', () => {
    const score = calculateCompetencyScore(
      [
        answer({ answerId: 'a1', questionVersionId: 'q1', weight: 2, effective: { ...answer().effective, score: 4 } }),
        answer({ answerId: 'a2', questionVersionId: 'q2', weight: 1, effective: { ...answer().effective, score: 1 } }),
      ],
      cfg(),
    );
    // (2*1.0*4 + 1*1.0*1) / (2+1) = 3
    expect(score.score0to4).toBe(3);
    expect(score.score0to100).toBe(75);
    expect(score.level).toBe(3);
    expect(score.notEnoughEvidence).toBe(false);
  });

  it('ответ без доказательств получает меньший вес', () => {
    const withEvidence = calculateCompetencyScore(
      [
        answer({ answerId: 'a1', questionVersionId: 'q1', supportingEvidenceCount: 2, effective: { ...answer().effective, score: 4 } }),
        answer({ answerId: 'a2', questionVersionId: 'q2', supportingEvidenceCount: 2, effective: { ...answer().effective, score: 0 } }),
      ],
      cfg(),
    );
    const weakEvidence = calculateCompetencyScore(
      [
        answer({ answerId: 'a1', questionVersionId: 'q1', supportingEvidenceCount: 2, effective: { ...answer().effective, score: 4 } }),
        answer({ answerId: 'a2', questionVersionId: 'q2', supportingEvidenceCount: 0, effective: { ...answer().effective, score: 0 } }),
      ],
      cfg(),
    );
    expect(withEvidence.score0to4).toBe(2);
    expect(weakEvidence.score0to4).toBeGreaterThan(2);
  });

  it('отсутствие данных не обнуляет компетенцию', () => {
    const score = calculateCompetencyScore(
      [answer({ effective: { ...answer().effective, score: NOT_ENOUGH_EVIDENCE } })],
      cfg(),
    );
    expect(score.notEnoughEvidence).toBe(true);
    expect(score.score0to4).toBeNull();
    expect(score.score0to100).toBeNull();
    expect(score.level).toBeNull();
  });

  it('пустой список даёт notEnoughEvidence', () => {
    const score = calculateCompetencyScore([], cfg());
    expect(score.notEnoughEvidence).toBe(true);
    expect(score.confidence).toBe(0);
  });

  it('уровень округляется к ближайшему целому', () => {
    const mk = (v: number) =>
      calculateCompetencyScore([answer({ effective: { ...answer().effective, score: v } })], cfg()).level;
    expect(mk(2.4)).toBe(2);
    expect(mk(2.5)).toBe(3);
    expect(mk(3.9)).toBe(4);
  });

  it('детерминизм: одинаковый вход даёт идентичный результат', () => {
    const inputs = [answer({ answerId: 'a1', questionVersionId: 'q1' }), answer({ answerId: 'a2', questionVersionId: 'q2' })];
    expect(JSON.stringify(calculateCompetencyScore(inputs, cfg()))).toBe(
      JSON.stringify(calculateCompetencyScore(inputs, cfg())),
    );
  });
});

describe('calculateConfidence', () => {
  it('растёт с количеством доказательств и независимых вопросов', () => {
    const low = calculateConfidence([answer({ supportingEvidenceCount: 1 })], cfg());
    const high = calculateConfidence(
      [
        answer({ answerId: 'a1', questionVersionId: 'q1', supportingEvidenceCount: 2 }),
        answer({ answerId: 'a2', questionVersionId: 'q2', supportingEvidenceCount: 2 }),
        answer({ answerId: 'a3', questionVersionId: 'q3', supportingEvidenceCount: 2 }),
      ],
      cfg(),
    );
    expect(high).toBeGreaterThan(low);
  });

  it('human review повышает confidence', () => {
    const base = answer();
    const reviewed = answer({
      effective: { ...base.effective, humanReviewed: true },
    });
    expect(calculateConfidence([reviewed], cfg())).toBeGreaterThan(calculateConfidence([base], cfg()));
  });

  it('низкая согласованность оценщиков снижает confidence', () => {
    const agree = answer({ effective: { ...answer().effective, agreement: 1 } });
    const disagree = answer({ effective: { ...answer().effective, agreement: 0.25 } });
    expect(calculateConfidence([agree], cfg())).toBeGreaterThan(calculateConfidence([disagree], cfg()));
  });

  it('confidence не выходит за пределы 0..1', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      answer({ answerId: `a${i}`, questionVersionId: `q${i}`, supportingEvidenceCount: 10, effective: { ...answer().effective, humanReviewed: true } }),
    );
    const c = calculateConfidence(many, cfg());
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

const competency = (over: Partial<CompetencyScore> = {}): CompetencyScore => ({
  competencyCode: 'CAUSAL',
  weight: 50,
  score0to4: 3,
  score0to100: 75,
  level: 3,
  confidence: 0.8,
  evidenceCount: 4,
  questionCount: 3,
  notEnoughEvidence: false,
  humanReviewedCount: 0,
  reviewRequired: false,
  isHardGate: false,
  ...over,
});

describe('calculateAssessmentScore', () => {
  it('взвешивает компетенции и учитывает полное покрытие', () => {
    const result = calculateAssessmentScore([
      competency({ competencyCode: 'A', weight: 60, score0to100: 80, score0to4: 3.2 }),
      competency({ competencyCode: 'B', weight: 40, score0to100: 50, score0to4: 2 }),
    ]);
    expect(result.overall0to100).toBe(68);
    expect(result.coverage).toBe(1);
    expect(result.band).toBe('SUFFICIENT');
    expect(result.insufficientData).toBe(false);
  });

  it('перенормирует веса при отсутствии данных по части компетенций', () => {
    const result = calculateAssessmentScore([
      competency({ competencyCode: 'A', weight: 70, score0to100: 80 }),
      competency({ competencyCode: 'B', weight: 30, score0to100: null, score0to4: null, notEnoughEvidence: true }),
    ]);
    expect(result.overall0to100).toBe(80);
    expect(result.coverage).toBe(0.7);
    expect(result.scoredCompetencies).toBe(1);
  });

  it('coverage ниже минимума даёт «Недостаточно данных»', () => {
    const result = calculateAssessmentScore([
      competency({ competencyCode: 'A', weight: 40, score0to100: 90 }),
      competency({ competencyCode: 'B', weight: 60, score0to100: null, score0to4: null, notEnoughEvidence: true }),
    ]);
    expect(result.coverage).toBe(0.4);
    expect(result.insufficientData).toBe(true);
    expect(result.band).toBe('INSUFFICIENT_DATA');
    // Балл остаётся справочным, но не обнуляется.
    expect(result.overall0to100).toBe(90);
  });

  it('полное отсутствие данных не даёт нулевого балла', () => {
    const result = calculateAssessmentScore([
      competency({ score0to100: null, score0to4: null, notEnoughEvidence: true }),
    ]);
    expect(result.overall0to100).toBeNull();
    expect(result.band).toBe('INSUFFICIENT_DATA');
  });

  it('confidence итога учитывает покрытие', () => {
    const full = calculateAssessmentScore([competency({ weight: 100, confidence: 0.8 })]);
    const partial = calculateAssessmentScore([
      competency({ competencyCode: 'A', weight: 70, confidence: 0.8 }),
      competency({ competencyCode: 'B', weight: 30, notEnoughEvidence: true, score0to100: null, score0to4: null }),
    ]);
    expect(full.confidence).toBeGreaterThan(partial.confidence);
  });
});

describe('resolveBand', () => {
  it('присваивает нейтральные квалификационные категории по порогам', () => {
    expect(resolveBand(90, 1, DEFAULT_BAND_THRESHOLDS)).toBe('EXPERT');
    expect(resolveBand(85, 1, DEFAULT_BAND_THRESHOLDS)).toBe('EXPERT');
    expect(resolveBand(84.9, 1, DEFAULT_BAND_THRESHOLDS)).toBe('HIGH');
    expect(resolveBand(70, 1, DEFAULT_BAND_THRESHOLDS)).toBe('HIGH');
    expect(resolveBand(55, 1, DEFAULT_BAND_THRESHOLDS)).toBe('SUFFICIENT');
    expect(resolveBand(40, 1, DEFAULT_BAND_THRESHOLDS)).toBe('GAPS');
    expect(resolveBand(39.9, 1, DEFAULT_BAND_THRESHOLDS)).toBe('NOT_CONFIRMED');
  });

  it('уважает редактируемые пороги администратора', () => {
    expect(resolveBand(80, 1, { EXPERT: 75, HIGH: 60, SUFFICIENT: 45, GAPS: 30 })).toBe('EXPERT');
  });

  it('низкое покрытие важнее балла', () => {
    expect(resolveBand(95, 0.3, DEFAULT_BAND_THRESHOLDS)).toBe('INSUFFICIENT_DATA');
  });
});

describe('calculateAxisScores', () => {
  it('агрегирует компетенции по осям с их весами', () => {
    const axes = calculateAxisScores(
      [
        competency({ competencyCode: 'PREVENTION', weight: 15, score0to4: 4 }),
        competency({ competencyCode: 'CAUSAL', weight: 5, score0to4: 2 }),
      ],
      { PREVENTION: 'PREVENTIVE_THINKING', CAUSAL: 'PREVENTIVE_THINKING' },
    );
    expect(axes).toHaveLength(1);
    expect(axes[0]?.axis).toBe('PREVENTIVE_THINKING');
    expect(axes[0]?.score0to4).toBe(3.5);
  });

  it('ось без данных помечается notEnoughEvidence', () => {
    const axes = calculateAxisScores(
      [competency({ competencyCode: 'COMMUNICATION', notEnoughEvidence: true, score0to4: null, score0to100: null })],
      { COMMUNICATION: 'COMMUNICATION' },
    );
    expect(axes[0]?.notEnoughEvidence).toBe(true);
    expect(axes[0]?.score0to4).toBeNull();
  });
});

describe('detectCriticalGaps', () => {
  it('отмечает критическую компетенцию ниже порога без отклонения кандидата', () => {
    const gaps = detectCriticalGaps([
      competency({ competencyCode: 'RISK_ESCALATION', isHardGate: true, score0to4: 1.5 }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.status).toBe('REQUIRES_ADDITIONAL_CHECK');
    expect(gaps[0]?.message).toBe('Критическая компетенция требует дополнительной проверки');
    expect(JSON.stringify(gaps)).not.toMatch(/отказ|reject|принять/i);
  });

  it('отсутствие доказательств по критической компетенции тоже требует проверки', () => {
    const gaps = detectCriticalGaps([
      competency({ competencyCode: 'CAUSAL', isHardGate: true, notEnoughEvidence: true, score0to4: null }),
    ]);
    expect(gaps[0]?.reason).toBe('NOT_ENOUGH_EVIDENCE');
  });

  it('не отмечает достаточный уровень и не-критические компетенции', () => {
    expect(
      detectCriticalGaps([
        competency({ competencyCode: 'CAUSAL', isHardGate: true, score0to4: 2 }),
        competency({ competencyCode: 'ECONOMICS', isHardGate: false, score0to4: 0.5 }),
      ]),
    ).toHaveLength(0);
  });

  it('уважает настраиваемый порог hard-gate', () => {
    const gaps = detectCriticalGaps(
      [competency({ competencyCode: 'CAUSAL', isHardGate: true, score0to4: 2.5 })],
      { ...DEFAULT_SCORING_PARAMS, gateThreshold: 3 },
    );
    expect(gaps).toHaveLength(1);
  });
});
