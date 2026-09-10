import { COMPETENCIES } from './catalog.js';
import {
  CONSTRUCT_MAP_SYSTEM,
  DEDUP_SYSTEM,
  EVALUATOR_A_SYSTEM,
  EVALUATOR_B_SYSTEM,
  INTERVIEW_QUESTIONS_SYSTEM,
} from '../../src/server/llm/promptAssembly.js';
import {
  DEDUP_SCHEMA,
  buildAssessmentSchema,
  buildConstructMapSchema,
  buildInterviewQuestionsSchema,
} from '../../src/server/llm/schemas.js';
import { LLM_FLAG_CODES } from '../../src/server/scoring/riskFlags.js';
import { DEFAULT_SCORING_PARAMS } from '../../src/server/scoring/types.js';

const ALL_CODES = COMPETENCIES.map((c) => c.code);

/**
 * Версионированные шаблоны промптов (§32). Изменение промпта не меняет
 * исторические оценки: они ссылаются на конкретную версию.
 */
export const PROMPT_TEMPLATES = [
  {
    code: 'EVAL_A_CORE',
    version: 1,
    role: 'EVAL_A' as const,
    systemPrompt: EVALUATOR_A_SYSTEM,
    userTemplate:
      'Собирается автоматически в src/server/llm/promptAssembly.ts: доверенная часть ' +
      '(вопрос, контекст кейса, rubric) и отдельная недоверенная часть с ответом кандидата.',
    jsonSchema: buildAssessmentSchema(ALL_CODES, LLM_FLAG_CODES) as unknown as object,
  },
  {
    code: 'EVAL_B_CORE',
    version: 1,
    role: 'EVAL_B' as const,
    systemPrompt: EVALUATOR_B_SYSTEM,
    userTemplate:
      'Та же сборка, что и для EVAL_A, но с обратным порядком анализа: сначала ' +
      'установление отсутствующих доказательств.',
    jsonSchema: buildAssessmentSchema(ALL_CODES, LLM_FLAG_CODES) as unknown as object,
  },
  {
    code: 'INTERVIEW_Q_CORE',
    version: 1,
    role: 'INTERVIEW_Q' as const,
    systemPrompt: INTERVIEW_QUESTIONS_SYSTEM,
    userTemplate:
      'Передаются: компетенции с низкой уверенностью, критические компетенции, ' +
      'выявленные расхождения, отсутствующие доказательства и идентификаторы ответов.',
    jsonSchema: buildInterviewQuestionsSchema(ALL_CODES) as unknown as object,
  },
  {
    code: 'DEDUP_CORE',
    version: 1,
    role: 'DEDUP' as const,
    systemPrompt: DEDUP_SYSTEM,
    userTemplate: 'Передаются два конструкта кандидата в виде пар полюсов и пояснений.',
    jsonSchema: DEDUP_SCHEMA as unknown as object,
  },
  {
    code: 'CONSTRUCT_MAP_CORE',
    version: 1,
    role: 'CONSTRUCT_MAP' as const,
    systemPrompt: CONSTRUCT_MAP_SYSTEM,
    userTemplate: 'Передаются конструкт кандидата и перечень доступных кодов компетенций.',
    jsonSchema: buildConstructMapSchema(ALL_CODES) as unknown as object,
  },
];

/** Версия модели агрегации (§32). Пересчёт возможен только явной командой. */
export const SCORING_MODEL = {
  code: 'CORE_WEIGHTED',
  version: 1,
  description:
    'Взвешенная агрегация по компетенциям с перенормировкой по покрытию данными, ' +
    'confidence отдельно от балла, hard-gates без автоматического отклонения. ' +
    'Соответствует docs/SCORING.md.',
  params: {
    disagreementThreshold: DEFAULT_SCORING_PARAMS.disagreementThreshold,
    gateThreshold: DEFAULT_SCORING_PARAMS.gateThreshold,
    minCoverage: DEFAULT_SCORING_PARAMS.minCoverage,
    confidenceWeights: DEFAULT_SCORING_PARAMS.confidenceWeights,
    neutralAgreement: DEFAULT_SCORING_PARAMS.neutralAgreement,
    evidenceQuality: { targetSupportingQuotes: 2, minFactor: 0.5 },
    reflection: { targetSelfIdealGap: 0.35, weightInSelfAwareness: 0.25 },
  } as unknown as object,
};
