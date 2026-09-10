import pino from 'pino';
import { getEnv } from '../config/env.js';

/**
 * Технические логи (docs/SECURITY.md §7). Audit log — отдельная сущность в БД.
 * Чувствительные поля вырезаются на уровне сериализатора.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  '*.password',
  'token',
  '*.token',
  'tokenHash',
  'apiKey',
  'LLM_API_KEY',
  'SESSION_SECRET',
  'INVITATION_SECRET',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'nestro' },
  formatters: { level: (label) => ({ level: label }) },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

/** Идентификатор запроса для сквозной трассировки. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export function safeLogLevel(): string {
  try {
    return getEnv().LOG_LEVEL;
  } catch {
    return 'info';
  }
}
