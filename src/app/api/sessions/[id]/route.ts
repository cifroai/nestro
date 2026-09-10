import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { forbidden } from '@/server/http/errors.js';
import { getSessionState } from '@/server/services/testSessionService.js';

/**
 * Состояние сессии. Доступно кандидату-владельцу либо сотруднику с правом
 * session:read. Кандидат другой сессии получает 403 (docs/SECURITY.md T1).
 */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'public' },
  async ({ params, ctx }) => {
    if (ctx.candidate) {
      if (ctx.candidate.testSessionId !== params.id) throw forbidden('Сессия недоступна');
      return getSessionState(params.id);
    }
    if (ctx.user?.permissions.includes(PERMISSIONS.SESSION_READ)) {
      return getSessionState(params.id);
    }
    throw forbidden('Сессия недоступна');
  },
);
