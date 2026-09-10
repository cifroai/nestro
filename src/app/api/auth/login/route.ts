import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route.js';
import { login, sessionCookieOptions, STAFF_COOKIE } from '@/server/auth/session.js';
import { loginSchema } from '@/server/validation/common.js';
import { usesSecureCookies } from '@/server/config/env.js';

/** Вход сотрудника. CSRF не применим (сессии ещё нет), проверяется Origin. */
export const POST = withRoute(
  {
    actor: 'public',
    bodySchema: loginSchema,
    skipCsrf: true,
    rateLimit: { rule: 'LOGIN', keyOf: (ctx) => ctx.ip ?? 'unknown' },
  },
  async ({ body, ctx }) => {
    const result = await login(body.email, body.password, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    // Вход создаёт сессию: статус 201 согласован с docs/API.md и OpenAPI.
    const response = NextResponse.json(
      {
        user: {
          id: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          roles: result.user.roles,
          permissions: result.user.permissions,
        },
        csrfToken: result.user.csrfSecret,
        expiresAt: result.expiresAt.toISOString(),
      },
      { status: 201 },
    );
    response.cookies.set(STAFF_COOKIE, result.token, sessionCookieOptions(result.expiresAt, usesSecureCookies()));
    return response;
  },
);
