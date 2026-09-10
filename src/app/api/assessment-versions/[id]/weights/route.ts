import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { weightsSchema } from '@/server/validation/common.js';
import { updateWeights } from '@/server/services/assessmentService.js';

/**
 * Изменение весов компетенций (§13, §14). Допустимо только в черновой
 * версии; сумма приводится к 100; изменение фиксируется в журнале аудита.
 */
export const PATCH = withRoute<z.infer<typeof weightsSchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.WEIGHTS_WRITE, bodySchema: weightsSchema },
  async ({ params, body, ctx }) => {
    await updateWeights(params.id, body.weights, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { updated: true };
  },
);
