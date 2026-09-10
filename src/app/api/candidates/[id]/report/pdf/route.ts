import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { notFound } from '@/server/http/errors.js';
import { enqueuePdfReport } from '@/server/queue/queues.js';
import { generatePdfReport } from '@/server/services/pdfService.js';

/**
 * Генерация PDF. При доступном Redis выполняется в очереди; иначе —
 * синхронно, чтобы функция не зависела от наличия брокера.
 */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ, rateLimit: { rule: 'EXPORT' } },
  async ({ params, ctx }) => {
    const session = await prisma.testSession.findFirst({
      where: { candidateId: params.id, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });
    if (!session) throw notFound('Завершённая сессия тестирования не найдена');

    const queued = await enqueuePdfReport(session.id, ctx.user!.id);
    if (queued) return { queued: true, sessionId: session.id };

    const result = await generatePdfReport(session.id, ctx.user!.id);
    return { queued: false, ...result };
  },
);
