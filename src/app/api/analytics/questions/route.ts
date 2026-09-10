import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { positionFilterSchema } from '@/server/validation/common.js';
import { questionStats, recomputeQuestionStats } from '@/server/services/analyticsService.js';

/** Статистика качества вопросов (§50). Автоудаление вопросов не выполняется. */
export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.ANALYTICS_READ, querySchema: positionFilterSchema },
  async ({ query }) => ({
    items: await questionStats(query.positionCode),
    note: 'Отметка «требует методической проверки» не влечёт автоматических изменений в банке вопросов.',
  }),
);

export const POST = withRoute(
  { actor: 'staff', permission: PERMISSIONS.QUESTION_WRITE },
  async () => recomputeQuestionStats(),
);
