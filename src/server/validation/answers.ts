import { z } from 'zod';

/**
 * Схемы значений ответов кандидата. Серверная валидация обязательна:
 * клиентские проверки не являются защитой (docs/SECURITY.md §6).
 */

const nonEmpty = (min: number, max = 20_000) => z.string().trim().min(min).max(max);

export const triadAnswerSchema = z
  .object({
    kind: z.literal('KELLY_TRIAD'),
    triadId: z.string().min(1).max(64),
    /** Коды двух наиболее похожих элементов триады. */
    similarPair: z.array(z.string().min(1).max(16)).length(2),
    similarity: nonEmpty(40),
    difference: nonEmpty(40),
    poleLeft: nonEmpty(8, 200),
    poleRight: nonEmpty(8, 200),
    importanceReason: nonEmpty(40),
    rigManifestation: nonEmpty(40),
    experienceExample: nonEmpty(80),
    /** Необязательная произвольная метка элементов; фамилии не требуются. */
    elementLabels: z.record(z.string().max(60)).optional(),
  })
  .strict();

export const similarityVerdictSchema = z
  .object({
    kind: z.literal('CONSTRUCT_SIMILARITY_VERDICT'),
    checkId: z.string().min(1).max(64),
    verdict: z.enum(['SAME', 'DIFFERENT']),
    explanation: z.string().trim().max(4000).optional(),
  })
  .strict();

export const gridRatingSchema = z
  .object({
    kind: z.literal('GRID_RATING'),
    constructId: z.string().min(1).max(64),
    elementId: z.string().min(1).max(64),
    rating: z.number().int().min(1).max(7),
  })
  .strict();

export const gridCompleteSchema = z
  .object({ kind: z.literal('GRID_COMPLETE') })
  .strict();

export const ladderAnswerSchema = z
  .object({
    kind: z.literal('LADDER_STEP'),
    constructId: z.string().min(1).max(64),
    depth: z.number().int().min(1).max(5),
    answer: z.string().trim().min(1).max(4000),
  })
  .strict();

export const caseAnswerSchema = z
  .object({
    kind: z.literal('CASE'),
    /** Значения подполей структуры разбора; состав задан QuestionVersion.subFields. */
    fields: z.record(z.string().max(20_000)),
  })
  .strict();

export const textAnswerSchema = z
  .object({
    kind: z.literal('TEXT'),
    text: z.string().max(20_000),
  })
  .strict();

export const numericAnswerSchema = z
  .object({
    kind: z.literal('NUMERIC'),
    value: z.number().finite(),
    unit: z.string().max(32).optional(),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export const choiceAnswerSchema = z
  .object({
    kind: z.literal('CHOICE'),
    selected: z.array(z.string().max(64)).max(32),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export const rankingAnswerSchema = z
  .object({
    kind: z.literal('RANKING'),
    order: z.array(z.string().max(64)).max(32),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export const selfRatingAnswerSchema = z
  .object({
    kind: z.literal('SELF_RATING'),
    ratings: z.array(
      z
        .object({
          competencyCode: z.string().min(1).max(64),
          level: z.number().int().min(0).max(4),
          justification: z.string().trim().max(4000),
        })
        .strict(),
    ),
  })
  .strict();

export const answerValueSchema = z.discriminatedUnion('kind', [
  triadAnswerSchema,
  similarityVerdictSchema,
  gridRatingSchema,
  gridCompleteSchema,
  ladderAnswerSchema,
  caseAnswerSchema,
  textAnswerSchema,
  numericAnswerSchema,
  choiceAnswerSchema,
  rankingAnswerSchema,
  selfRatingAnswerSchema,
]);

export type AnswerValue = z.infer<typeof answerValueSchema>;

export const telemetrySchema = z
  .object({
    shownAt: z.string().datetime().optional(),
    firstInputAt: z.string().datetime().optional(),
    msActive: z.number().int().min(0).max(86_400_000).optional(),
    focusLossCount: z.number().int().min(0).max(10_000).optional(),
    returned: z.boolean().optional(),
  })
  .strict();

export const saveAnswerSchema = z
  .object({
    sessionId: z.string().min(1).max(64),
    questionVersionId: z.string().min(1).max(64).optional(),
    stageIndex: z.number().int().min(0).max(20).optional(),
    value: answerValueSchema,
    /** DRAFT — автосохранение, SUBMITTED — окончательная отправка шага. */
    status: z.enum(['DRAFT', 'SUBMITTED']).default('DRAFT'),
    telemetry: telemetrySchema.optional(),
    clientRevision: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;

/**
 * Плоский текст ответа: используется для полнотекстового поиска и как
 * недоверенный вход LLM. Служебные поля (идентификаторы) не включаются.
 */
export function extractAnswerText(value: AnswerValue): string {
  switch (value.kind) {
    case 'KELLY_TRIAD':
      return [
        value.similarity,
        value.difference,
        `${value.poleLeft} ↔ ${value.poleRight}`,
        value.importanceReason,
        value.rigManifestation,
        value.experienceExample,
      ].join('\n');
    case 'CONSTRUCT_SIMILARITY_VERDICT':
      return value.explanation ?? '';
    case 'LADDER_STEP':
      return value.answer;
    case 'CASE':
      return Object.entries(value.fields)
        .map(([key, text]) => `${key}: ${text}`)
        .join('\n');
    case 'TEXT':
      return value.text;
    case 'NUMERIC':
      return [String(value.value), value.unit ?? '', value.comment ?? ''].filter(Boolean).join(' ');
    case 'CHOICE':
      return [value.selected.join(', '), value.comment ?? ''].filter(Boolean).join('\n');
    case 'RANKING':
      return [value.order.join(' > '), value.comment ?? ''].filter(Boolean).join('\n');
    case 'SELF_RATING':
      return value.ratings
        .map((r) => `${r.competencyCode}: уровень ${r.level}. ${r.justification}`)
        .join('\n');
    case 'GRID_RATING':
    case 'GRID_COMPLETE':
      return '';
  }
}

/** Числовое значение для аналитики, если применимо. */
export function extractNumericValue(value: AnswerValue): number | null {
  if (value.kind === 'NUMERIC') return value.value;
  if (value.kind === 'GRID_RATING') return value.rating;
  return null;
}

export interface SubFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  minLength?: number;
}

/**
 * Проверка обязательных подполей кейса при окончательной отправке.
 * Автосохранение (DRAFT) не требует полноты — иначе прогресс терялся бы.
 */
export function validateSubFields(
  value: AnswerValue,
  definitions: SubFieldDefinition[],
): Array<{ key: string; message: string }> {
  if (value.kind !== 'CASE') return [];
  const errors: Array<{ key: string; message: string }> = [];
  for (const def of definitions) {
    const raw = (value.fields[def.key] ?? '').trim();
    if (def.required && raw.length === 0) {
      errors.push({ key: def.key, message: `Поле «${def.label}» обязательно для заполнения` });
      continue;
    }
    if (def.minLength && raw.length > 0 && raw.length < def.minLength) {
      errors.push({
        key: def.key,
        message: `Поле «${def.label}» требует не менее ${def.minLength} символов`,
      });
    }
  }
  return errors;
}
