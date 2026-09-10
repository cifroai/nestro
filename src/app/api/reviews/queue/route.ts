import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { paginationSchema, positionFilterSchema } from '@/server/validation/common.js';
import { reviewQueue } from '@/server/services/reviewService.js';

const querySchema = paginationSchema.merge(positionFilterSchema).extend({
  onlyRequired: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const GET = withRoute<undefined, z.infer<typeof querySchema>>(
  { actor: 'staff', permission: PERMISSIONS.REVIEW_READ, querySchema },
  async ({ query }) => reviewQueue(query),
);
