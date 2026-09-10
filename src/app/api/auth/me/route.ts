import { withRoute } from '@/server/http/route.js';

/** Профиль и полный список прав текущего пользователя. */
export const GET = withRoute({ actor: 'staff' }, async ({ ctx }) => ({
  user: {
    id: ctx.user?.id,
    email: ctx.user?.email,
    fullName: ctx.user?.fullName,
    roles: ctx.user?.roles ?? [],
    permissions: ctx.user?.permissions ?? [],
  },
  csrfToken: ctx.user?.csrfSecret,
}));
