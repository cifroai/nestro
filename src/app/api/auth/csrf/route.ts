import { withRoute } from '@/server/http/route.js';

/** Выдача CSRF-токена текущей сессии (staff или кандидат). */
export const GET = withRoute({ actor: 'public' }, async ({ ctx }) => ({
  csrfToken: ctx.user?.csrfSecret ?? ctx.candidate?.csrfSecret ?? null,
  authenticated: Boolean(ctx.user ?? ctx.candidate),
}));
