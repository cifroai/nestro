import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { prisma } from '@/server/db/prisma.js';
import { notFound } from '@/server/http/errors.js';

/** Карточка кандидата: профиль и перечень сессий (без сырых оценок). */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.CANDIDATE_READ },
  async ({ params }) => {
    const candidate = await prisma.candidate.findUnique({
      where: { id: params.id },
      include: {
        position: { select: { code: true, title: true } },
        sessions: {
          select: {
            id: true,
            status: true,
            assessmentStatus: true,
            startedAt: true,
            completedAt: true,
            reviewRequired: true,
            reviewCompletedAt: true,
            version: { select: { version: true, assessment: { select: { title: true } } } },
          },
          orderBy: { createdAt: 'desc' },
        },
        invitations: { select: { id: true, status: true, expiresAt: true, createdAt: true } },
        outcome: true,
      },
    });
    if (!candidate) throw notFound('Кандидат не найден');
    return candidate;
  },
);
