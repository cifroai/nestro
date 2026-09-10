import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { completeSessionReview } from '@/server/services/reviewService.js';

export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REVIEW_WRITE },
  async ({ params, ctx }) => {
    await completeSessionReview(params.id, { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId });
    return { ok: true };
  },
);
