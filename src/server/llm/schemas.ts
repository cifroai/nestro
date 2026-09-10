import type { JSONSchemaObject } from './types.js';

/**
 * Строгие JSON Schema контракты выхода LLM (docs/LLM_ASSESSMENT.md §4).
 * Свободный текст не парсится регулярными выражениями (§39).
 */

const citation = {
  type: 'object',
  additionalProperties: false,
  required: ['quote', 'comment'],
  properties: {
    quote: { type: 'string', minLength: 10, maxLength: 600 },
    comment: { type: 'string', maxLength: 600 },
  },
} as const;

export function buildAssessmentSchema(
  competencyCodes: string[],
  riskFlagCodes: string[],
): JSONSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'dimension_scores',
      'evidence',
      'missing_evidence',
      'risk_flags',
      'strengths',
      'ambiguities',
      'confidence',
      'review_required',
    ],
    properties: {
      dimension_scores: {
        type: 'array',
        maxItems: Math.max(1, competencyCodes.length),
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'competency_code',
            'score',
            'not_enough_evidence',
            'explanation',
            'rubric_rule',
            'confidence',
            'evidence_quotes',
          ],
          properties: {
            competency_code: { type: 'string', enum: competencyCodes },
            score: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            not_enough_evidence: { type: 'boolean' },
            explanation: { type: 'string', minLength: 1, maxLength: 1200 },
            rubric_rule: { type: 'string', maxLength: 400 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence_quotes: {
              type: 'array',
              maxItems: 5,
              items: { type: 'string', minLength: 10, maxLength: 600 },
            },
          },
        },
      },
      evidence: { type: 'array', maxItems: 20, items: citation },
      missing_evidence: {
        type: 'array',
        maxItems: 20,
        items: { type: 'string', maxLength: 300 },
      },
      risk_flags: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'quote', 'explanation', 'severity'],
          properties: {
            code: { type: 'string', enum: riskFlagCodes },
            quote: { type: 'string', minLength: 10, maxLength: 600 },
            explanation: { type: 'string', minLength: 1, maxLength: 600 },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          },
        },
      },
      strengths: { type: 'array', maxItems: 10, items: citation },
      ambiguities: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      review_required: { type: 'boolean' },
    },
  };
}

export function buildInterviewQuestionsSchema(competencyCodes: string[]): JSONSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'rationale', 'ref_answer_ids'],
          properties: {
            text: { type: 'string', minLength: 20, maxLength: 800 },
            rationale: { type: 'string', minLength: 10, maxLength: 600 },
            competency_code: { type: 'string', enum: competencyCodes },
            /** Обязательная ссылка на фактические ответы кандидата (§46). */
            ref_answer_ids: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
      },
    },
  };
}

export const DEDUP_SCHEMA: JSONSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['similar', 'score', 'reasoning'],
  properties: {
    similar: { type: 'boolean' },
    score: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string', maxLength: 400 },
  },
};

export function buildConstructMapSchema(competencyCodes: string[]): JSONSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['mappings'],
    properties: {
      mappings: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['competency_code', 'quote', 'confidence'],
          properties: {
            competency_code: { type: 'string', enum: competencyCodes },
            quote: { type: 'string', minLength: 5, maxLength: 600 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

/** Форма разобранного ответа оценщика (после валидации схемой). */
export interface AssessmentOutput {
  dimension_scores: Array<{
    competency_code: string;
    score: number | null;
    not_enough_evidence: boolean;
    explanation: string;
    rubric_rule: string;
    confidence: number;
    evidence_quotes: string[];
  }>;
  evidence: Array<{ quote: string; comment: string }>;
  missing_evidence: string[];
  risk_flags: Array<{ code: string; quote: string; explanation: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }>;
  strengths: Array<{ quote: string; comment: string }>;
  ambiguities: string[];
  confidence: number;
  review_required: boolean;
}

export interface InterviewQuestionsOutput {
  questions: Array<{
    text: string;
    rationale: string;
    competency_code?: string;
    ref_answer_ids: string[];
  }>;
}
