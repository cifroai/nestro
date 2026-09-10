import { withRoute } from '@/server/http/route.js';
import { openInvitation } from '@/server/services/invitationService.js';

/**
 * Публичная карточка приглашения (§25): должность, структура теста, правила,
 * дедлайн. Никаких данных оценки здесь нет.
 */
export const GET = withRoute<undefined, undefined, { token: string }>(
  {
    actor: 'public',
    rateLimit: { rule: 'INVITE_EXCHANGE', keyOf: (ctx) => ctx.ip ?? 'unknown' },
  },
  async ({ params, ctx }) => openInvitation(params.token, { ip: ctx.ip }),
);
