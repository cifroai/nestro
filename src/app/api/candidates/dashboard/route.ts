import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { positionFilterSchema } from '@/server/validation/common.js';
import { dashboardCounters } from '@/server/services/candidateService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.CANDIDATE_READ, querySchema: positionFilterSchema },
  async ({ query }) => dashboardCounters(query.positionCode),
);
