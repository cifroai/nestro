import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { cancelInvitation } from '@/server/services/invitationService.js';

export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.INVITATION_WRITE },
  async ({ params, ctx }) => {
    await cancelInvitation(params.id, { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId });
    return { ok: true };
  },
);
