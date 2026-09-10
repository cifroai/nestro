import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';

/** Версионированные шаблоны промптов (§32). */
export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.PROMPT_READ },
  async () => ({
    items: await prisma.promptTemplate.findMany({
      select: {
        id: true,
        code: true,
        version: true,
        role: true,
        isActive: true,
        createdAt: true,
        systemPrompt: true,
      },
      orderBy: [{ role: 'asc' }, { version: 'desc' }],
    }),
  }),
);
