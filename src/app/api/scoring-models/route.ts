import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';

/** Версии модели агрегации (§32). Изменение — только новой версией. */
export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.SCORING_MODEL_READ },
  async () => ({
    items: await prisma.scoringModel.findMany({ orderBy: [{ code: 'asc' }, { version: 'desc' }] }),
  }),
);
