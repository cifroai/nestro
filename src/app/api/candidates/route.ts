import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { candidateListSchema } from '@/server/validation/common.js';
import { listCandidates } from '@/server/services/candidateService.js';

/** Таблица кандидатов с фильтрами (§26). */
export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.CANDIDATE_READ, querySchema: candidateListSchema },
  async ({ query }) => listCandidates(query),
);
