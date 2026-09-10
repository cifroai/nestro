import { withRoute } from '@/server/http/route.js';
import { assertOwnsSession } from '@/server/auth/candidateSession.js';
import { getSessionState } from '@/server/services/testSessionService.js';

/** Следующий шаг прохождения для кандидата. */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'candidate' },
  async ({ params, ctx }) => {
    assertOwnsSession(ctx.candidate!, params.id);
    const state = await getSessionState(params.id);
    return { step: state.step, payload: state.stepPayload, progressPercent: state.progressPercent };
  },
);
