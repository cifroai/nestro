import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { recomputeSession } from '@/server/services/reviewService.js';

/**
 * Явный пересчёт итоговых баллов (§32). Создаёт новые записи FinalScore
 * и запись в журнале аудита; исторические результаты сохраняются.
 */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.SCORING_RECOMPUTE },
  async ({ params, ctx }) =>
    recomputeSession(params.id, { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId }),
);
