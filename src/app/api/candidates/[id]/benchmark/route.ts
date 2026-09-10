import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { notFound } from '@/server/http/errors.js';
import { benchmarkComparison } from '@/server/services/candidateService.js';

const querySchema = z.object({ benchmarkCode: z.string().min(1).max(64) });

/** Сравнение профиля кандидата с распределением эталонной группы (§48). */
export const GET = withRoute<undefined, z.infer<typeof querySchema>, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.BENCHMARK_READ, querySchema },
  async ({ params, query }) => {
    const session = await prisma.testSession.findFirst({
      where: { candidateId: params.id, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });
    if (!session) throw notFound('Завершённая сессия тестирования не найдена');
    return benchmarkComparison(query.benchmarkCode, session.id);
  },
);
