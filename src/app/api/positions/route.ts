import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { AUDIT_ACTIONS, recordAudit } from '@/server/services/auditService.js';

const bodySchema = z
  .object({
    code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/, 'Код должен состоять из заглавных латинских букв, цифр и подчёркиваний'),
    title: z.string().min(3).max(200),
    family: z.string().max(64).optional(),
    description: z.string().max(4000).optional(),
  })
  .strict();

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.POSITION_READ },
  async () => ({
    items: await prisma.position.findMany({
      include: { _count: { select: { assessments: true, candidates: true } } },
      orderBy: [{ orderIndex: 'asc' }, { title: 'asc' }],
    }),
  }),
);

/** Новая должность добавляется данными; ядро системы не меняется (§FR-2.1). */
export const POST = withRoute<z.infer<typeof bodySchema>>(
  { actor: 'staff', permission: PERMISSIONS.POSITION_WRITE, bodySchema },
  async ({ body, ctx }) => {
    const position = await prisma.position.create({ data: body });
    await recordAudit({
      action: 'position.created',
      entity: 'Position',
      entityId: position.id,
      actorUserId: ctx.user!.id,
      newValue: body,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return position;
  },
);

export { AUDIT_ACTIONS };
