import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { benchmarkSchema } from '@/server/validation/common.js';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/auditService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.BENCHMARK_READ },
  async () => ({
    items: await prisma.benchmark.findMany({
      include: { position: { select: { code: true, title: true } }, _count: { select: { members: true } } },
      orderBy: { title: 'asc' },
    }),
    note: 'Статистическая близость к эталонной группе не означает профессиональную пригодность.',
  }),
);

/** Эталонная группа подтверждённых специалистов (§48). */
export const POST = withRoute<z.infer<typeof benchmarkSchema>>(
  { actor: 'staff', permission: PERMISSIONS.BENCHMARK_WRITE, bodySchema: benchmarkSchema },
  async ({ body, ctx }) => {
    const position = await prisma.position.findUniqueOrThrow({ where: { code: body.positionCode } });
    const benchmark = await prisma.benchmark.upsert({
      where: { code: body.code },
      update: { title: body.title, description: body.description ?? null, positionId: position.id },
      create: {
        code: body.code,
        title: body.title,
        description: body.description ?? null,
        positionId: position.id,
      },
    });
    if (body.candidateIds) {
      await prisma.benchmarkMember.deleteMany({ where: { benchmarkId: benchmark.id } });
      await prisma.benchmarkMember.createMany({
        data: body.candidateIds.map((candidateId) => ({ benchmarkId: benchmark.id, candidateId })),
        skipDuplicates: true,
      });
    }
    await recordAudit({
      action: AUDIT_ACTIONS.BENCHMARK_UPDATED,
      entity: 'Benchmark',
      entityId: benchmark.id,
      actorUserId: ctx.user!.id,
      newValue: { code: body.code, members: body.candidateIds?.length ?? 0 },
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return benchmark;
  },
);
