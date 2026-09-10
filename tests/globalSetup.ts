import { execSync } from 'node:child_process';

/**
 * Подготовка тестовой БД: применение миграций и идемпотентного seed.
 *
 * Используется только `migrate deploy` (применение готовых миграций) —
 * разрушающие операции над базой в тестовой подготовке не выполняются.
 * Данные кандидатов при необходимости очищаются точечно в самих тестах
 * (см. tests/helpers/db.ts, resetCandidateData).
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public';

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };

  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed/index.ts', { env, stdio: 'pipe' });
}
