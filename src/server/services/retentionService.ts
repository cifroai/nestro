import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import { notFound } from '../http/errors.js';

/**
 * Политика хранения и права субъекта данных (§44, docs/SECURITY.md §8).
 *
 * Обезличивание сохраняет профессиональное содержание ответов (оно нужно для
 * методической статистики), но удаляет идентифицирующие данные кандидата.
 */

export interface AnonymizeResult {
  anonymized: number;
  retentionMonths: number;
}

export async function anonymizeExpiredCandidates(): Promise<AnonymizeResult> {
  const months = getEnv().RETENTION_MONTHS;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const candidates = await prisma.candidate.findMany({
    where: {
      anonymizedAt: null,
      sessions: { every: { completedAt: { lte: cutoff } } },
      // Кандидаты без сессий не подпадают под срок: их считаем от даты создания.
      OR: [{ sessions: { some: {} } }, { createdAt: { lte: cutoff } }],
    },
    select: { id: true, fullName: true },
    take: 200,
  });

  let counter = 0;
  for (const candidate of candidates) {
    await anonymizeCandidate(candidate.id, {
      actorKind: 'SYSTEM',
      reason: `Автоматическое обезличивание по политике хранения (${months} мес.)`,
    });
    counter += 1;
  }

  return { anonymized: counter, retentionMonths: months };
}

export interface AnonymizeContext {
  actorUserId?: string | null;
  actorKind?: 'USER' | 'SYSTEM';
  reason: string;
  ip?: string | null;
  requestId?: string | null;
}

/** Обезличивание одного кандидата (право субъекта данных или срок хранения). */
export async function anonymizeCandidate(
  candidateId: string,
  ctx: AnonymizeContext,
): Promise<void> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, fullName: true, email: true, anonymizedAt: true },
  });
  if (!candidate) throw notFound('Кандидат не найден');
  if (candidate.anonymizedAt) return;

  const sequence = await prisma.candidate.count({ where: { anonymizedAt: { not: null } } });
  const label = `Кандидат #${sequence + 1}`;

  await prisma.$transaction(async (tx) => {
    await tx.candidate.update({
      where: { id: candidateId },
      data: {
        fullName: label,
        email: null,
        externalRef: null,
        sourceChannel: null,
        anonymizedAt: new Date(),
      },
    });
    // Приглашения теряют возможность повторного открытия.
    await tx.invitation.updateMany({
      where: { candidateId },
      data: { status: 'EXPIRED', expiresAt: new Date() },
    });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.CANDIDATE_ANONYMIZED,
    entity: 'Candidate',
    entityId: candidateId,
    actorUserId: ctx.actorUserId ?? null,
    actorKind: ctx.actorKind ?? 'USER',
    oldValue: { hadEmail: candidate.email !== null },
    newValue: { label, reason: ctx.reason },
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });
}

/** Полный экспорт данных кандидата (право на доступ к своим данным). */
export async function exportCandidateData(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      position: { select: { code: true, title: true } },
      consents: true,
      invitations: {
        select: { id: true, status: true, createdAt: true, expiresAt: true, openedAt: true, completedAt: true },
      },
      sessions: {
        include: {
          answers: {
            include: {
              questionVersion: { select: { prompt: true, question: { select: { code: true } } } },
              revisions: { orderBy: { revision: 'asc' } },
            },
          },
          constructs: { include: { ladderSteps: true, ratings: true } },
          finalScores: { include: { competency: { select: { code: true } } } },
          riskFlags: true,
          contradictions: true,
          interviewQs: true,
          gridAnalyses: true,
        },
      },
      outcome: true,
    },
  });
  if (!candidate) throw notFound('Кандидат не найден');
  return candidate;
}
