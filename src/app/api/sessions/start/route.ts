import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route.js';
import { startSessionSchema } from '@/server/validation/common.js';
import { startSession, getSessionState } from '@/server/services/testSessionService.js';
import { CANDIDATE_COOKIE } from '@/server/auth/session.js';
import { isProduction } from '@/server/config/env.js';
import { resolveCandidate } from '@/server/auth/candidateSession.js';

/**
 * Старт или продолжение прохождения по одноразовой ссылке.
 * Выдаёт cookie кандидатской сессии, изолированную от staff-сессии.
 */
export const POST = withRoute(
  {
    actor: 'public',
    bodySchema: startSessionSchema,
    skipCsrf: true,
    rateLimit: { rule: 'INVITE_EXCHANGE', keyOf: (ctx) => ctx.ip ?? 'unknown' },
  },
  async ({ body, ctx }) => {
    const started = await startSession(body.token, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    const principal = await resolveCandidate(started.candidateToken);
    const state = await getSessionState(started.sessionId);

    const response = NextResponse.json({
      sessionId: started.sessionId,
      resumed: started.resumed,
      csrfToken: principal?.csrfSecret ?? null,
      state,
    });
    response.cookies.set(CANDIDATE_COOKIE, started.candidateToken, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
      expires: started.tokenExpiresAt,
    });
    return response;
  },
);
