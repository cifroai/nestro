import { prisma } from '../db/prisma.js';
import { badRequest, notFound } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import { enqueueFinalizeScoring } from '../queue/queues.js';
import { finalizeScoring } from './scoringService.js';
import { isRedisAvailable } from '../queue/redis.js';
import { logger } from '../logging/logger.js';

/**
 * Экспертная проверка (§29). Сохраняются все три величины:
 * model_score, human_score, final_score — плюс причина, автор и время.
 */

export interface SubmitReviewInput {
  dimensionScoreId?: string;
  answerId?: string;
  competencyId?: string;
  humanScore?: number | null;
  markedUninformative?: boolean;
  reviewReason: string;
}

export interface ReviewContext {
  userId: string;
  ip?: string | null;
  requestId?: string | null;
}

const MIN_REASON_LENGTH = 20;

export async function submitReview(input: SubmitReviewInput, ctx: ReviewContext) {
  if (input.reviewReason.trim().length < MIN_REASON_LENGTH) {
    throw badRequest(
      `Укажите причину изменения оценки (не менее ${MIN_REASON_LENGTH} символов). ` +
        'Причина попадает в отчёт и в журнал аудита.',
    );
  }
  if (!input.dimensionScoreId && !(input.answerId && input.competencyId)) {
    throw badRequest('Укажите либо оценку компетенции (dimensionScoreId), либо пару answerId + competencyId');
  }
  if (
    input.humanScore !== undefined &&
    input.humanScore !== null &&
    (input.humanScore < 0 || input.humanScore > 4)
  ) {
    throw badRequest('Экспертная оценка допускается в диапазоне 0..4');
  }

  let answerId = input.answerId ?? null;
  let competencyId = input.competencyId ?? null;
  let modelScore: number | null = null;

  if (input.dimensionScoreId) {
    const dimension = await prisma.lLMDimensionScore.findUnique({
      where: { id: input.dimensionScoreId },
      include: { llmAssessment: { select: { answerId: true } } },
    });
    if (!dimension) throw notFound('Оценка компетенции не найдена');
    answerId = dimension.llmAssessment.answerId;
    competencyId = dimension.competencyId;
    modelScore = dimension.score === null ? null : Number(dimension.score);
  }

  if (!answerId || !competencyId) throw notFound('Не удалось определить ответ и компетенцию');

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    select: { id: true, sessionId: true },
  });
  if (!answer) throw notFound('Ответ не найден');

  const markedUninformative = input.markedUninformative ?? false;
  const humanScore = markedUninformative ? null : (input.humanScore ?? null);
  const finalScore = markedUninformative ? null : humanScore;

  const review = await prisma.humanReview.create({
    data: {
      dimensionScoreId: input.dimensionScoreId ?? null,
      answerId,
      competencyId,
      modelScore,
      humanScore,
      finalScore,
      reviewReason: input.reviewReason.trim(),
      markedUninformative,
      reviewerId: ctx.userId,
    },
    include: { competency: { select: { code: true, title: true } } },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.REVIEW_SUBMITTED,
    entity: 'HumanReview',
    entityId: review.id,
    actorUserId: ctx.userId,
    oldValue: { modelScore },
    newValue: {
      answerId,
      competencyCode: review.competency.code,
      humanScore,
      finalScore,
      markedUninformative,
      reviewReason: review.reviewReason,
    },
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });

  // Пересчёт итогов после экспертной правки — явная операция с audit-записью.
  let recomputeQueued = await enqueueFinalizeScoring(answer.sessionId, 'HUMAN_REVIEW', ctx.userId);
  if (!recomputeQueued) {
    // Без Redis пересчёт выполняется синхронно, чтобы эксперт сразу видел итог.
    try {
      await finalizeScoring(answer.sessionId, {
        reason: 'HUMAN_REVIEW',
        actorUserId: ctx.userId,
        requestId: ctx.requestId ?? null,
      });
      recomputeQueued = true;
    } catch (err) {
      logger.error({ err, sessionId: answer.sessionId }, 'синхронный пересчёт после review не выполнен');
    }
  }

  return { review, recomputeQueued };
}

/** Подтверждение модельной оценки без изменения балла. */
export async function confirmScore(
  dimensionScoreId: string,
  reason: string,
  ctx: ReviewContext,
) {
  const dimension = await prisma.lLMDimensionScore.findUnique({
    where: { id: dimensionScoreId },
    select: { score: true, notEnoughEvidence: true },
  });
  if (!dimension) throw notFound('Оценка компетенции не найдена');
  return submitReview(
    {
      dimensionScoreId,
      humanScore: dimension.score === null ? null : Number(dimension.score),
      markedUninformative: dimension.notEnoughEvidence,
      reviewReason: reason,
    },
    ctx,
  );
}

export interface ReviewQueueQuery {
  positionCode?: string;
  onlyRequired?: boolean;
  page?: number;
  pageSize?: number;
}

/** Очередь экспертной проверки (§26). */
export async function reviewQueue(query: ReviewQueueQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

  const where = {
    status: 'COMPLETED' as const,
    ...(query.onlyRequired === false ? {} : { reviewRequired: true }),
    reviewCompletedAt: null,
    ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.testSession.findMany({
      where,
      include: {
        candidate: { select: { id: true, fullName: true, position: { select: { title: true, code: true } } } },
        version: { select: { version: true, assessment: { select: { title: true } } } },
        finalScores: {
          where: { supersededById: null, competencyId: null, axis: null },
          select: { score0to100: true, band: true, confidence: true, coverage: true },
        },
        riskFlags: { select: { code: true, severity: true } },
        _count: { select: { answers: true } },
      },
      orderBy: { completedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.testSession.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

/** Отметка о завершении экспертной проверки сессии. */
export async function completeSessionReview(sessionId: string, ctx: ReviewContext): Promise<void> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, invitationId: true },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');

  await prisma.testSession.update({
    where: { id: sessionId },
    data: { reviewCompletedAt: new Date(), reviewRequired: false },
  });
  if (session.invitationId) {
    await prisma.invitation.update({
      where: { id: session.invitationId },
      data: { status: 'REVIEWED' },
    });
  }

  await recordAudit({
    action: 'review.session.completed',
    entity: 'TestSession',
    entityId: sessionId,
    actorUserId: ctx.userId,
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });
}

/**
 * Явный пересчёт итогов (§32). Никогда не выполняется молча:
 * создаёт новые FinalScore и запись в журнале аудита.
 */
export async function recomputeSession(sessionId: string, ctx: ReviewContext) {
  const queued = await isRedisAvailable()
    ? await enqueueFinalizeScoring(sessionId, 'RECOMPUTE', ctx.userId)
    : false;

  if (queued) return { queued: true, result: null };

  const result = await finalizeScoring(sessionId, {
    reason: 'RECOMPUTE',
    actorUserId: ctx.userId,
    requestId: ctx.requestId ?? null,
  });
  return { queued: false, result };
}

/** Подтверждение или снятие маркера риска экспертом. */
export async function updateRiskFlag(
  flagId: string,
  action: 'CONFIRM' | 'DISMISS',
  ctx: ReviewContext,
): Promise<void> {
  const flag = await prisma.riskFlag.findUnique({ where: { id: flagId } });
  if (!flag) throw notFound('Маркер риска не найден');

  await prisma.riskFlag.update({
    where: { id: flagId },
    data: {
      confirmedByUserId: action === 'CONFIRM' ? ctx.userId : null,
      dismissedAt: action === 'DISMISS' ? new Date() : null,
    },
  });

  await recordAudit({
    action: action === 'CONFIRM' ? 'risk_flag.confirmed' : 'risk_flag.dismissed',
    entity: 'RiskFlag',
    entityId: flagId,
    actorUserId: ctx.userId,
    oldValue: { code: flag.code, confirmedByUserId: flag.confirmedByUserId, dismissedAt: flag.dismissedAt },
    newValue: { action },
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });
}
