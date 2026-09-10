import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { notFound } from '@/server/http/errors.js';
import { buildDrillDown } from '@/server/services/reportService.js';

const querySchema = z.object({
  competencyCode: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64).optional(),
});

/**
 * Обязательный drill-down (§28): вопросы, ответы, цитаты, оценки каждого
 * evaluator, применённая rubric и история ручных корректировок.
 */
export const GET = withRoute<undefined, z.infer<typeof querySchema>, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ, querySchema },
  async ({ params, query }) => {
    const session = query.sessionId
      ? await prisma.testSession.findFirst({ where: { id: query.sessionId, candidateId: params.id } })
      : await prisma.testSession.findFirst({
          where: { candidateId: params.id, status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
        });
    if (!session) throw notFound('Завершённая сессия тестирования не найдена');
    return buildDrillDown(session.id, query.competencyCode);
  },
);
