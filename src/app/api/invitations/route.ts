import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { createInvitationSchema, invitationListSchema } from '@/server/validation/common.js';
import { createInvitation, listInvitations } from '@/server/services/invitationService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.INVITATION_READ, querySchema: invitationListSchema },
  async ({ query }) => listInvitations(query),
);

/** Создание приглашения. Ссылка с токеном возвращается ровно один раз. */
export const POST = withRoute(
  { actor: 'staff', permission: PERMISSIONS.INVITATION_WRITE, bodySchema: createInvitationSchema },
  async ({ body, ctx }) => {
    const invitation = await createInvitation(
      {
        fullName: body.fullName,
        email: body.email ?? null,
        positionCode: body.positionCode,
        assessmentVersionId: body.assessmentVersionId,
        expiresAt: body.expiresAt,
        maxAttempts: body.maxAttempts,
        experienceYears: body.experienceYears ?? null,
        sourceChannel: body.sourceChannel ?? null,
      },
      { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId },
    );
    return {
      invitation,
      warning: 'Ссылка отображается один раз. Сохраните её перед закрытием окна.',
    };
  },
);
