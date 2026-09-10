import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { updateRolesSchema } from '@/server/validation/common.js';
import { updateUserRoles } from '@/server/services/userService.js';

/** Изменение ролей отзывает активные сессии пользователя немедленно. */
export const PATCH = withRoute<z.infer<typeof updateRolesSchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.ROLE_WRITE, bodySchema: updateRolesSchema },
  async ({ params, body, ctx }) => {
    await updateUserRoles(params.id, body.roleCodes, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { updated: true, sessionsRevoked: true };
  },
);
