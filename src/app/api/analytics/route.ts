import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { periodSchema, positionFilterSchema } from '@/server/validation/common.js';
import { analyticsSummary } from '@/server/services/analyticsService.js';

const querySchema = positionFilterSchema.merge(periodSchema);

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.ANALYTICS_READ, querySchema },
  async ({ query }) => analyticsSummary(query),
);
