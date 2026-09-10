import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { thresholdsSchema } from '@/server/validation/common.js';
import { updateThresholds } from '@/server/services/assessmentService.js';

/** Пороги квалификационных категорий и параметры оценки (§18, §16, §19). */
export const PATCH = withRoute<z.infer<typeof thresholdsSchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.WEIGHTS_WRITE, bodySchema: thresholdsSchema },
  async ({ params, body, ctx }) => {
    await updateThresholds(params.id, body, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { updated: true };
  },
);
