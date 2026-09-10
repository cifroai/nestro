import { withRoute } from '@/server/http/route.js';
import { assertOwnsSession } from '@/server/auth/candidateSession.js';
import { completeSession } from '@/server/services/testSessionService.js';

/**
 * Завершение тестирования. Кандидату возвращается только подтверждение:
 * ни баллов, ни маркеров риска, ни рейтинга (§75).
 */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'candidate' },
  async ({ params, ctx }) => {
    assertOwnsSession(ctx.candidate!, params.id);
    return completeSession(params.id, { ip: ctx.ip, requestId: ctx.requestId });
  },
);
