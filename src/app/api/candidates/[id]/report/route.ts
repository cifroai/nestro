import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { notFound } from '@/server/http/errors.js';
import { buildReport } from '@/server/services/reportService.js';

/**
 * Полный отчёт (§45). Параметр sessionId позволяет выбрать конкретную
 * попытку; по умолчанию берётся последняя завершённая.
 */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ },
  async ({ params, request }) => {
    const url = new URL(request.url);
    const requested = url.searchParams.get('sessionId');

    const session = requested
      ? await prisma.testSession.findFirst({ where: { id: requested, candidateId: params.id } })
      : await prisma.testSession.findFirst({
          where: { candidateId: params.id, status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
        });
    if (!session) throw notFound('Завершённая сессия тестирования не найдена');

    return buildReport(session.id);
  },
);
