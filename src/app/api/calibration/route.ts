import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { periodSchema, positionFilterSchema } from '@/server/validation/common.js';
import { calibrationMetrics, outcomeCorrelation } from '@/server/services/calibrationService.js';

const querySchema = positionFilterSchema.merge(periodSchema);

/**
 * Калибровка (§31): сопоставление модельных и экспертных оценок.
 * Веса модели автоматически не изменяются.
 */
export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.CALIBRATION_READ, querySchema },
  async ({ query }) => ({
    metrics: await calibrationMetrics(query),
    outcomes: await outcomeCorrelation(query.positionCode),
  }),
);
