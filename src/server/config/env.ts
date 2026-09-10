import { z } from 'zod';

/**
 * Валидация конфигурации при старте процесса (docs/SECURITY.md §9).
 * Процесс не поднимается при отсутствии критичных переменных.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379/0'),
  SESSION_SECRET: z.string().min(32),
  INVITATION_SECRET: z.string().min(32),
  APP_URL: z.string().url(),

  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'openrouter', 'local', 'none']).default('none'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL_PRIMARY: z.string().optional(),
  LLM_MODEL_SECONDARY: z.string().optional(),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_000).default(2000),

  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  RETENTION_MONTHS: z.coerce.number().int().min(1).max(240).default(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /// Отключение rate limit допустимо только в тестах.
  DISABLE_RATE_LIMIT: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация окружения: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Только для тестов: сброс кеша конфигурации. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const isTest = (): boolean => getEnv().NODE_ENV === 'test';
