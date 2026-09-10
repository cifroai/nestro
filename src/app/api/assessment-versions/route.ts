import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { listPublishedVersions } from '@/server/services/assessmentService.js';
import { positionFilterSchema } from '@/server/validation/common.js';

/** Версии, доступные для приглашения: только опубликованные. */
export const GET = withRoute<undefined, z.infer<typeof positionFilterSchema>>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_READ, querySchema: positionFilterSchema },
  async ({ query }) => ({ items: await listPublishedVersions(query.positionCode) }),
);
