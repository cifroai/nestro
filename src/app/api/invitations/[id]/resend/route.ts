import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { resendInvitationSchema } from '@/server/validation/common.js';
import { resendInvitation } from '@/server/services/invitationService.js';

/** Перевыпуск приглашения: прежний токен становится недействительным. */
export const POST = withRoute<{ expiresAt?: Date }, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.INVITATION_WRITE, bodySchema: resendInvitationSchema },
  async ({ params, body, ctx }) => {
    const result = await resendInvitation(
      params.id,
      { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId },
      body?.expiresAt,
    );
    return { ...result, warning: 'Прежняя ссылка более не действует.' };
  },
);
