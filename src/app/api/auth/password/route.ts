import { withRoute } from '@/server/http/route.js';
import { changePasswordSchema } from '@/server/validation/common.js';
import { changeOwnPassword } from '@/server/services/userService.js';

export const POST = withRoute(
  { actor: 'staff', bodySchema: changePasswordSchema },
  async ({ body, ctx }) => {
    await changeOwnPassword(ctx.user!.id, body.currentPassword, body.newPassword, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { ok: true };
  },
);
