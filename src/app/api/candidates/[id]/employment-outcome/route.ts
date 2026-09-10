import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { employmentOutcomeSchema } from '@/server/validation/common.js';
import { recordEmploymentOutcome } from '@/server/services/candidateService.js';

/**
 * Данные после трудоустройства (§30). Вносятся только уполномоченным
 * пользователем и не влияют автоматически на модель оценки.
 */
export const POST = withRoute<z.infer<typeof employmentOutcomeSchema>, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.EMPLOYMENT_OUTCOME_WRITE, bodySchema: employmentOutcomeSchema },
  async ({ params, body, ctx }) =>
    recordEmploymentOutcome(params.id, body, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    }),
);
