import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { anonymizeCandidate } from '@/server/services/retentionService.js';

const bodySchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();

/** Обезличивание данных кандидата по запросу (§44). */
export const POST = withRoute<z.infer<typeof bodySchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.CANDIDATE_ERASE, bodySchema },
  async ({ params, body, ctx }) => {
    await anonymizeCandidate(params.id, {
      actorUserId: ctx.user!.id,
      reason: body.reason,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { anonymized: true };
  },
);
