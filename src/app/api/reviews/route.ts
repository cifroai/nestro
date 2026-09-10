import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { reviewSchema } from '@/server/validation/common.js';
import { submitReview } from '@/server/services/reviewService.js';

/**
 * Экспертная проверка (§29). Сохраняются model_score, human_score,
 * final_score, причина, автор и время; итоги пересчитываются явно.
 */
export const POST = withRoute<z.infer<typeof reviewSchema>>(
  { actor: 'staff', permission: PERMISSIONS.REVIEW_WRITE, bodySchema: reviewSchema },
  async ({ body, ctx }) =>
    submitReview(body, { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId }),
);
