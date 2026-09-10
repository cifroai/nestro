import { createHash } from 'node:crypto';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JSONSchemaObject } from './types.js';

/**
 * Валидация структурированного выхода (docs/LLM_ASSESSMENT.md §4, требование §39).
 * Смысл НИКОГДА не извлекается регулярными выражениями — допускается только
 * структурное снятие markdown-обёртки вокруг JSON.
 */

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
addFormats(ajv);

const compiled = new Map<string, ValidateFunction>();

/**
 * Ключ кеша включает отпечаток самой схемы, а не только её имя.
 * Схема одного и того же контракта различается по набору допустимых кодов
 * компетенций для каждого вопроса; кеширование по имени применяло бы схему
 * первого вопроса ко всем последующим.
 */
function cacheKey(schemaName: string, schema: JSONSchemaObject): string {
  const fingerprint = createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 32);
  return `${schemaName}:${fingerprint}`;
}

function compile(schemaName: string, schema: JSONSchemaObject): ValidateFunction {
  const key = cacheKey(schemaName, schema);
  const cached = compiled.get(key);
  if (cached) return cached;
  const fn = ajv.compile(schema);
  compiled.set(key, fn);
  return fn;
}

/**
 * Извлечение JSON-объекта из текста ответа. Операция строго структурная:
 * снятие ```json-обёртки и обрезка по внешним фигурным скобкам с учётом
 * строковых литералов и экранирования.
 */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const fenceStart = trimmed.indexOf('```');
  let candidate = trimmed;
  if (fenceStart >= 0) {
    const afterFence = trimmed.slice(fenceStart + 3);
    const newline = afterFence.indexOf('\n');
    const body = newline >= 0 ? afterFence.slice(newline + 1) : afterFence;
    const fenceEnd = body.lastIndexOf('```');
    candidate = (fenceEnd >= 0 ? body.slice(0, fenceEnd) : body).trim();
  }

  const start = candidate.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: string;
  stage: 'PARSE' | 'SCHEMA';
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'неизвестная ошибка схемы';
  return errors
    .slice(0, 8)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
    .join('; ');
}

export function validateStructuredOutput<T>(
  raw: string | unknown,
  schema: JSONSchemaObject,
  schemaName: string,
): ValidationResult<T> {
  let parsed: unknown;
  if (typeof raw === 'string') {
    const json = extractJson(raw);
    if (!json) return { ok: false, error: 'В ответе не найден JSON-объект', stage: 'PARSE' };
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return { ok: false, error: `Некорректный JSON: ${String(err)}`, stage: 'PARSE' };
    }
  } else {
    parsed = raw;
  }

  const validate = compile(schemaName, schema);
  if (!validate(parsed)) {
    return { ok: false, error: formatErrors(validate.errors), stage: 'SCHEMA' };
  }
  return { ok: true, value: parsed as T };
}

/** Только для тестов: сброс кеша скомпилированных схем. */
export function resetSchemaCache(): void {
  compiled.clear();
}
