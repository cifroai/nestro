import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { resetPassword } from '@/server/services/userService.js';

/** Сброс пароля администратором. Пароль возвращается один раз. */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.USER_WRITE },
  async ({ params, ctx }) => {
    const result = await resetPassword(params.id, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return {
      ...result,
      warning: 'Пароль отображается один раз. Активные сессии пользователя отозваны.',
    };
  },
);
