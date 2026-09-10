import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { setUserActive } from '@/server/services/userService.js';

const bodySchema = z.object({ isActive: z.boolean() }).strict();

export const PATCH = withRoute<z.infer<typeof bodySchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.USER_WRITE, bodySchema },
  async ({ params, body, ctx }) => {
    await setUserActive(params.id, body.isActive, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { updated: true };
  },
);
