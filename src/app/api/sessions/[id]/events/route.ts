import { withRoute } from '@/server/http/route.js';
import { assertOwnsSession } from '@/server/auth/candidateSession.js';
import { sessionEventSchema } from '@/server/validation/common.js';
import { recordSessionEvent } from '@/server/services/testSessionService.js';

/**
 * Технический журнал сессии (§24): переключение вкладки, реконнект.
 * Служит для диагностики технических аномалий; кадровых выводов не влечёт.
 */
export const POST = withRoute<{ type: string; payload?: Record<string, unknown> }, undefined, { id: string }>(
  { actor: 'candidate', bodySchema: sessionEventSchema },
  async ({ params, body, ctx }) => {
    assertOwnsSession(ctx.candidate!, params.id);
    await recordSessionEvent(params.id, body.type, body.payload);
    return { recorded: true };
  },
);
