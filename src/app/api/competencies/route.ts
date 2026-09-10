import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { recordAudit } from '@/server/services/auditService.js';

const AXES = [
  'TECHNICAL_REASONING',
  'SYSTEM_THINKING',
  'RISK_MANAGEMENT',
  'PREVENTIVE_THINKING',
  'DECISION_MAKING',
  'OPERATIONAL_MATURITY',
  'COMMUNICATION',
  'SELF_AWARENESS',
] as const;

const bodySchema = z
  .object({
    code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/),
    title: z.string().min(3).max(200),
    description: z.string().max(4000),
    axis: z.enum(AXES),
  })
  .strict();

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.COMPETENCY_READ },
  async () => ({
    items: await prisma.competency.findMany({
      include: { rubrics: { include: { levels: { orderBy: { level: 'asc' } } }, orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    }),
    axes: AXES,
  }),
);

export const POST = withRoute<z.infer<typeof bodySchema>>(
  { actor: 'staff', permission: PERMISSIONS.COMPETENCY_WRITE, bodySchema },
  async ({ body, ctx }) => {
    const competency = await prisma.competency.create({ data: body });
    await recordAudit({
      action: 'competency.created',
      entity: 'Competency',
      entityId: competency.id,
      actorUserId: ctx.user!.id,
      newValue: body,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return competency;
  },
);
