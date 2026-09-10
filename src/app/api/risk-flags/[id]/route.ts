import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { updateRiskFlag } from '@/server/services/reviewService.js';

const bodySchema = z.object({ action: z.enum(['CONFIRM', 'DISMISS']) }).strict();

/** Подтверждение или снятие маркера риска экспертом. */
export const POST = withRoute<z.infer<typeof bodySchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REVIEW_WRITE, bodySchema },
  async ({ params, body, ctx }) => {
    await updateRiskFlag(params.id, body.action, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { ok: true };
  },
);
