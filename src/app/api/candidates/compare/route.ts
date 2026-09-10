import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { compareSchema } from '@/server/validation/common.js';
import { compareCandidates } from '@/server/services/candidateService.js';

/** Сравнение до пяти кандидатов (§47) без автоматического рейтинга. */
export const POST = withRoute<z.infer<typeof compareSchema>>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ, bodySchema: compareSchema },
  async ({ body }) => compareCandidates(body.sessionIds),
);
