import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { searchSchema } from '@/server/validation/common.js';
import { search, type SearchScope } from '@/server/services/searchService.js';

const ALL_SCOPES: SearchScope[] = ['candidates', 'constructs', 'answers', 'reviews'];

export const GET = withRoute<undefined, z.infer<typeof searchSchema>>(
  { actor: 'staff', permission: PERMISSIONS.CANDIDATE_READ, querySchema: searchSchema },
  async ({ query }) => {
    const requested = (query.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SearchScope => ALL_SCOPES.includes(s as SearchScope));
    return { items: await search(query.q, requested.length > 0 ? requested : ALL_SCOPES, query.limit) };
  },
);
