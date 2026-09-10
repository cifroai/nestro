import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma.js';
import { isRedisAvailable } from '@/server/queue/redis.js';

/**
 * Проба готовности: БД доступна и миграции применены; Redis доступен.
 * Недоступность Redis не блокирует прохождение теста, поэтому отражается
 * отдельным полем, но статус остаётся degraded, а не ready.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, boolean> = { database: false, migrations: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    checks.migrations = Number(pending[0]?.count ?? 0) === 0;
  } catch {
    checks.database = false;
  }

  checks.redis = await isRedisAvailable();

  const ready = checks.database && checks.migrations;
  return NextResponse.json(
    { status: ready ? (checks.redis ? 'ready' : 'degraded') : 'not-ready', checks },
    { status: ready ? 200 : 503 },
  );
}
