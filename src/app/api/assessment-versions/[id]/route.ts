import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { getVersionDetail } from '@/server/services/assessmentService.js';

export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_READ },
  async ({ params }) => getVersionDetail(params.id),
);
