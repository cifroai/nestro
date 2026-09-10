import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { createUserSchema } from '@/server/validation/common.js';
import { createUser, listUsers } from '@/server/services/userService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.USER_READ },
  async () => ({ items: await listUsers() }),
);

export const POST = withRoute<z.infer<typeof createUserSchema>>(
  { actor: 'staff', permission: PERMISSIONS.USER_WRITE, bodySchema: createUserSchema },
  async ({ body, ctx }) => {
    const result = await createUser(body, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return {
      user: { id: result.user.id, email: result.user.email, fullName: result.user.fullName },
      generatedPassword: result.generatedPassword,
      warning: result.generatedPassword
        ? 'Пароль отображается один раз. Передайте его пользователю защищённым каналом.'
        : null,
    };
  },
);
