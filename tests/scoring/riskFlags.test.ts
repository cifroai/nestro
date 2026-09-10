import { describe, expect, it } from 'vitest';
import {
  detectRuleFlags,
  RISK_FLAGS,
  RISK_FLAG_BY_CODE,
  type SessionSnapshot,
} from '@/server/scoring/riskFlags.js';
import {
  CONTRADICTION_PREFIX,
  detectCrossAnswerContradictions,
  type Declaration,
} from '@/server/scoring/contradictions.js';
import type { CompetencyScore } from '@/server/scoring/types.js';

const emptySnapshot = (): SessionSnapshot => ({
  triadAnswers: [],
  caseAnswers: [],
  openAnswers: [],
  grid: { ratings: [] },
});

const longExample = 'На кусте 12 при росте СНС и падении механической скорости мы заранее увеличили расход и включили ротацию, шлам вышел за два цикла.';

describe('каталог маркеров риска', () => {
  it('покрывает все маркеры из требований §20', () => {
    const codes = RISK_FLAGS.map((f) => f.code);
    for (const expected of [
      'DECIDES_WITHOUT_DATA', 'DENIES_UNCERTAINTY', 'IGNORES_RISK',
      'CAUSE_SYMPTOM_CONFUSION', 'PROCEDURE_VIOLATION_UNASSESSED', 'AVOIDS_DECISIONS',
      'ACTS_BEYOND_AUTHORITY', 'SILO_FOCUS', 'NO_RESULT_CONTROL', 'BLAME_SEEKING',
      'NO_EXPERIENCE_EXAMPLE', 'GENERIC_ANSWERS',
    ]) {
      expect(codes).toContain(expected);
    }
  });

  it('коды уникальны', () => {
    expect(new Set(RISK_FLAGS.map((f) => f.code)).size).toBe(RISK_FLAGS.length);
  });
});

describe('detectRuleFlags', () => {
  it('не порождает флагов на пустом снимке (никаких предположений)', () => {
    expect(detectRuleFlags(emptySnapshot())).toEqual([]);
  });

  it('отмечает отсутствие примеров из опыта в половине триад со ссылкой на ответ', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      triadAnswers: [
        { answerId: 'a1', experienceExample: 'бывало' },
        { answerId: 'a2', experienceExample: longExample },
      ],
    });
    const flag = flags.find((f) => f.code === 'NO_EXPERIENCE_EXAMPLE');
    expect(flag).toBeDefined();
    expect(flag?.answerId).toBe('a1');
    expect(flag?.source).toBe('RULE');
  });

  it('не отмечает, когда примеры содержательны', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      triadAnswers: [
        { answerId: 'a1', experienceExample: longExample },
        { answerId: 'a2', experienceExample: longExample },
      ],
    });
    expect(flags.find((f) => f.code === 'NO_EXPERIENCE_EXAMPLE')).toBeUndefined();
  });

  it('отмечает отсутствие запроса недостающих данных, критерия успеха и эскалации', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      caseAnswers: [
        { answerId: 'c1', missingInformation: '', successCriterion: null, escalationTrigger: '   ' },
      ],
    });
    const codes = flags.map((f) => f.code);
    expect(codes).toContain('NO_MISSING_DATA_REQUEST');
    expect(codes).toContain('NO_SUCCESS_CRITERION');
    expect(codes).toContain('NO_ESCALATION_MENTION');
    for (const f of flags) expect(f.answerId).toBe('c1');
  });

  it('достаточно одного заполненного кейса, чтобы флаг не выставлялся', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      caseAnswers: [
        { answerId: 'c1', missingInformation: '', successCriterion: '', escalationTrigger: '' },
        {
          answerId: 'c2',
          missingInformation: 'нужны данные по расходу и профилю ствола',
          successCriterion: 'стабилизация СНС и выход шлама',
          escalationTrigger: 'при росте давления более 15 атм уведомляю супервайзера',
        },
      ],
    });
    expect(flags.map((f) => f.code)).not.toContain('NO_ESCALATION_MENTION');
  });

  it('отмечает систематически общие ответы с цитатой', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      openAnswers: Array.from({ length: 12 }, (_, i) => ({ answerId: `o${i}`, text: 'надо контролировать параметры' })),
    });
    const flag = flags.find((f) => f.code === 'GENERIC_ANSWERS');
    expect(flag).toBeDefined();
    expect(flag?.quote).toBeTruthy();
  });

  it('не отмечает общие ответы при малой выборке вопросов', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      openAnswers: [{ answerId: 'o1', text: 'коротко' }],
    });
    expect(flags.map((f) => f.code)).not.toContain('GENERIC_ANSWERS');
  });

  it('отмечает решётку без различения элементов', () => {
    const flags = detectRuleFlags({ ...emptySnapshot(), grid: { ratings: Array(40).fill(4) } });
    expect(flags.map((f) => f.code)).toContain('GRID_NO_DISCRIMINATION');
  });

  it('отмечает крайнюю поляризацию', () => {
    const ratings = [...Array(20).fill(1), ...Array(20).fill(7)];
    const flags = detectRuleFlags({ ...emptySnapshot(), grid: { ratings } });
    expect(flags.map((f) => f.code)).toContain('EXTREME_POLARIZATION');
  });

  it('нормально заполненная решётка не даёт флагов', () => {
    const ratings = Array.from({ length: 40 }, (_, i) => (i % 7) + 1);
    const flags = detectRuleFlags({ ...emptySnapshot(), grid: { ratings } });
    expect(flags).toEqual([]);
  });

  it('каждый выставленный флаг известен каталогу и имеет объяснение', () => {
    const flags = detectRuleFlags({
      ...emptySnapshot(),
      triadAnswers: [{ answerId: 'a1', experienceExample: null }],
      caseAnswers: [{ answerId: 'c1', missingInformation: null, successCriterion: null, escalationTrigger: null }],
      grid: { ratings: Array(30).fill(1) },
    });
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(RISK_FLAG_BY_CODE.has(f.code)).toBe(true);
      expect(f.explanation.length).toBeGreaterThan(10);
    }
  });
});

const competency = (over: Partial<CompetencyScore>): CompetencyScore => ({
  competencyCode: 'PREVENTION',
  weight: 15,
  score0to4: 1,
  score0to100: 25,
  level: 1,
  confidence: 0.6,
  evidenceCount: 3,
  questionCount: 2,
  notEnoughEvidence: false,
  humanReviewedCount: 0,
  reviewRequired: false,
  isHardGate: false,
  ...over,
});

const declaration = (over: Partial<Declaration> = {}): Declaration => ({
  constructId: 'cc1',
  poleLeft: 'предупреждает развитие осложнения',
  poleRight: 'начинает действовать после возникновения осложнения',
  competencyCode: 'PREVENTION',
  importanceRank: 1,
  sourceAnswerIds: ['a10', 'a11'],
  ...over,
});

describe('detectCrossAnswerContradictions', () => {
  it('фиксирует расхождение декларации и решений в кейсах нейтральной формулировкой', () => {
    const result = detectCrossAnswerContradictions([declaration()], [competency({ score0to4: 1 })]);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain(CONTRADICTION_PREFIX);
    expect(result[0]?.description).not.toMatch(/лж|обман|неискрен/i);
    expect(result[0]?.strength).toBe(0.5);
    expect(result[0]?.answerIds).toEqual(['a10', 'a11']);
  });

  it('не фиксирует расхождение при достаточном уровне компетенции', () => {
    expect(detectCrossAnswerContradictions([declaration()], [competency({ score0to4: 3 })])).toEqual([]);
  });

  it('игнорирует конструкты вне топ-5 по значимости', () => {
    expect(
      detectCrossAnswerContradictions([declaration({ importanceRank: 7 })], [competency({ score0to4: 0.5 })]),
    ).toEqual([]);
  });

  it('не делает выводов при отсутствии данных по компетенции', () => {
    expect(
      detectCrossAnswerContradictions(
        [declaration()],
        [competency({ notEnoughEvidence: true, score0to4: null })],
      ),
    ).toEqual([]);
  });

  it('сортирует расхождения по силе', () => {
    const result = detectCrossAnswerContradictions(
      [
        declaration({ constructId: 'cc1', competencyCode: 'PREVENTION', importanceRank: 1 }),
        declaration({ constructId: 'cc2', competencyCode: 'CAUSAL', importanceRank: 2 }),
      ],
      [
        competency({ competencyCode: 'PREVENTION', score0to4: 1.5 }),
        competency({ competencyCode: 'CAUSAL', score0to4: 0.4 }),
      ],
    );
    expect(result.map((r) => r.competencyCode)).toEqual(['CAUSAL', 'PREVENTION']);
  });
});
