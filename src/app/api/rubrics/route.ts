import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.RUBRIC_READ },
  async () => ({
    items: await prisma.rubric.findMany({
      include: {
        competency: { select: { code: true, title: true } },
        levels: { orderBy: { level: 'asc' } },
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    }),
  }),
);
