import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';

const querySchema = z.object({ assessmentVersionId: z.string().min(1).max(64) });

/**
 * Кейсы хранятся в БД и не хардкодятся во frontend (§62).
 * Эндпоинт доступен только сотрудникам: кандидатская сессия получает
 * содержимое этапа через движок теста, без rubric и ожидаемых доказательств.
 */
export const GET = withRoute<undefined, z.infer<typeof querySchema>>(
  { actor: 'staff', permission: PERMISSIONS.SCENARIO_READ, querySchema },
  async ({ query }) => ({
    items: await prisma.scenario.findMany({
      where: { assessmentVersionId: query.assessmentVersionId },
      include: { stages: { orderBy: { stageIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    }),
  }),
);
