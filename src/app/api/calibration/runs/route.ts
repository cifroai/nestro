import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { calibrationRunSchema } from '@/server/validation/common.js';
import { listCalibrationRuns, recordCalibrationRun } from '@/server/services/calibrationService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.CALIBRATION_READ },
  async () => ({ items: await listCalibrationRuns() }),
);

export const POST = withRoute<z.infer<typeof calibrationRunSchema>>(
  { actor: 'staff', permission: PERMISSIONS.CALIBRATION_READ, bodySchema: calibrationRunSchema },
  async ({ body, ctx }) =>
    recordCalibrationRun(body.label, body, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    }),
);
