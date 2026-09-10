import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { listAssessments } from '@/server/services/assessmentService.js';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/auditService.js';
import { positionFilterSchema } from '@/server/validation/common.js';

const bodySchema = z
  .object({
    code: z.string().min(2).max(64),
    title: z.string().min(3).max(200),
    positionCode: z.string().min(1).max(64),
    description: z.string().max(4000).optional(),
  })
  .strict();

export const GET = withRoute<undefined, z.infer<typeof positionFilterSchema>>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_READ, querySchema: positionFilterSchema },
  async ({ query }) => {
    const position = query.positionCode
      ? await prisma.position.findUnique({ where: { code: query.positionCode }, select: { id: true } })
      : null;
    return { items: await listAssessments(position?.id) };
  },
);

export const POST = withRoute<z.infer<typeof bodySchema>>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_WRITE, bodySchema },
  async ({ body, ctx }) => {
    const position = await prisma.position.findUniqueOrThrow({ where: { code: body.positionCode } });
    const assessment = await prisma.assessment.create({
      data: {
        code: body.code,
        title: body.title,
        description: body.description ?? null,
        positionId: position.id,
        versions: { create: { version: 1, status: 'DRAFT', notes: 'Первая черновая версия' } },
      },
      include: { versions: true },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.ASSESSMENT_CREATED,
      entity: 'Assessment',
      entityId: assessment.id,
      actorUserId: ctx.user!.id,
      newValue: body,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return assessment;
  },
);
