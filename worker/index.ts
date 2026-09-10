import { Worker, type Job } from 'bullmq';
import { prisma } from '../src/server/db/prisma.js';
import { getEnv } from '../src/server/config/env.js';
import { logger } from '../src/server/logging/logger.js';
import { closeRedis, getRedis, isRedisAvailable } from '../src/server/queue/redis.js';
import {
  QUEUE_NAMES,
  enqueueAnswerEvaluation,
  enqueueFinalizeScoring,
  enqueueInterviewQuestions,
  enqueueSessionAssessment,
  scheduleMaintenance,
  type AssessmentJob,
  type MaintenanceJob,
  type ReportJob,
} from '../src/server/queue/queues.js';
import {
  allAnswersEvaluated,
  answersForEvaluation,
  evaluateAndStore,
} from '../src/server/services/evaluationService.js';
import { finalizeScoring } from '../src/server/services/scoringService.js';
import { generateInterviewQuestions } from '../src/server/services/interviewQuestionService.js';
import { expireOverdueSessions } from '../src/server/services/testSessionService.js';
import { LLMUnavailableError } from '../src/server/llm/types.js';
import { createProvider, resolveModels } from '../src/server/llm/factory.js';
import { generatePdfReport } from '../src/server/services/pdfService.js';
import { anonymizeExpiredCandidates } from '../src/server/services/retentionService.js';
import { recomputeQuestionStats } from '../src/server/services/analyticsService.js';

/**
 * Worker фоновых задач (docs/ARCHITECTURE.md ADR-5).
 *
 * Инвариант: ни одна кандидатская сессия не теряется из-за отказа LLM.
 * При LLMUnavailableError задача возвращается в очередь с задержкой,
 * а TestSession.assessmentStatus остаётся PENDING.
 */

const env = getEnv();

/** Используется ли второй оценщик: задаётся моделью версии ассессмента. */
async function isSecondEvaluatorEnabled(sessionId: string): Promise<boolean> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { version: { select: { llmModelSecondary: true, promptTemplateBId: true } } },
  });
  if (!session) return false;
  const models = resolveModels();
  // Второй оценщик работает и на той же модели: у него иной промпт (роль B).
  return Boolean(session.version.promptTemplateBId ?? models.secondary ?? models.primary);
}

async function handleSessionAssessment(sessionId: string): Promise<void> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, assessmentStatus: true },
  });
  if (!session) {
    logger.warn({ sessionId }, 'сессия не найдена, задача оценки пропущена');
    return;
  }
  if (session.status !== 'COMPLETED') {
    logger.info({ sessionId }, 'сессия не завершена, оценка отложена');
    return;
  }

  const provider = createProvider();
  const answerIds = await answersForEvaluation(sessionId);

  if (!provider.available) {
    // Ручная оценка возможна и без LLM: эксперт видит ответы и выставляет баллы.
    await prisma.testSession.update({
      where: { id: sessionId },
      data: { assessmentStatus: 'PENDING', reviewRequired: true },
    });
    logger.warn({ sessionId }, 'LLM-провайдер не настроен: оценка остаётся отложенной');
    throw new LLMUnavailableError();
  }

  await prisma.testSession.update({
    where: { id: sessionId },
    data: { assessmentStatus: 'RUNNING' },
  });

  const second = await isSecondEvaluatorEnabled(sessionId);
  for (const answerId of answerIds) {
    await enqueueAnswerEvaluation(answerId, 'A');
    if (second) await enqueueAnswerEvaluation(answerId, 'B');
  }

  logger.info({ sessionId, answers: answerIds.length, second }, 'оценка ответов поставлена в очередь');

  if (answerIds.length === 0) {
    await enqueueFinalizeScoring(sessionId, 'INITIAL');
  }
}

async function handleAnswerEvaluation(answerId: string, role: 'A' | 'B'): Promise<void> {
  const result = await evaluateAndStore(answerId, role);

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    select: { sessionId: true },
  });
  if (!answer) return;

  const second = await isSecondEvaluatorEnabled(answer.sessionId);
  if (await allAnswersEvaluated(answer.sessionId, second)) {
    await enqueueFinalizeScoring(answer.sessionId, 'INITIAL');
  }

  logger.debug({ answerId, role, ...result }, 'оценка ответа завершена');
}

async function handleFinalizeScoring(job: Extract<AssessmentJob, { type: 'FINALIZE_SCORING' }>): Promise<void> {
  const result = await finalizeScoring(job.sessionId, {
    reason: job.reason,
    actorUserId: job.actorUserId ?? null,
  });
  logger.info(result, 'итоговые баллы рассчитаны');
  if (job.reason !== 'HUMAN_REVIEW') {
    await enqueueInterviewQuestions(job.sessionId);
  }
}

async function processAssessmentJob(job: Job<AssessmentJob>): Promise<void> {
  switch (job.data.type) {
    case 'SESSION_ASSESSMENT':
      return handleSessionAssessment(job.data.sessionId);
    case 'ANSWER_EVALUATION':
      return handleAnswerEvaluation(job.data.answerId, job.data.evaluatorRole);
    case 'FINALIZE_SCORING':
      return handleFinalizeScoring(job.data);
    case 'INTERVIEW_QUESTIONS': {
      const result = await generateInterviewQuestions(job.data.sessionId);
      logger.info({ sessionId: job.data.sessionId, ...result }, 'вопросы к интервью сформированы');
      return;
    }
  }
}

async function processReportJob(job: Job<ReportJob>): Promise<void> {
  if (job.data.type === 'GENERATE_PDF') {
    const report = await generatePdfReport(job.data.sessionId, job.data.requestedByUserId);
    logger.info({ sessionId: job.data.sessionId, reportId: report.reportId }, 'PDF-отчёт сформирован');
  }
}

async function processMaintenanceJob(job: Job<MaintenanceJob>): Promise<void> {
  switch (job.data.type) {
    case 'RETRY_PENDING_ASSESSMENTS': {
      // Повторная постановка отложенных оценок после восстановления LLM/Redis.
      const pending = await prisma.testSession.findMany({
        where: { status: 'COMPLETED', assessmentStatus: { in: ['PENDING', 'FAILED'] } },
        select: { id: true },
        take: 50,
      });
      for (const session of pending) await enqueueSessionAssessment(session.id);
      if (pending.length > 0) {
        logger.info({ count: pending.length }, 'отложенные оценки поставлены в очередь повторно');
      }
      return;
    }
    case 'EXPIRE_SESSIONS': {
      const count = await expireOverdueSessions();
      if (count > 0) logger.info({ count }, 'сессии с истёкшим сроком закрыты');
      return;
    }
    case 'RETENTION': {
      const result = await anonymizeExpiredCandidates();
      if (result.anonymized > 0) logger.info(result, 'политика хранения применена');
      return;
    }
    case 'QUESTION_STATS': {
      const result = await recomputeQuestionStats();
      logger.info(result, 'статистика качества вопросов обновлена');
      return;
    }
  }
}

async function main(): Promise<void> {
  if (!(await isRedisAvailable())) {
    logger.error('Redis недоступен: worker не может запуститься. Проверьте REDIS_URL.');
    process.exit(1);
  }

  const connection = getRedis();

  const assessmentWorker = new Worker<AssessmentJob>(QUEUE_NAMES.ASSESSMENT, processAssessmentJob, {
    connection,
    concurrency: env.LLM_MAX_CONCURRENCY,
  });

  const reportWorker = new Worker<ReportJob>(QUEUE_NAMES.REPORT, processReportJob, {
    connection,
    concurrency: 2,
  });

  const maintenanceWorker = new Worker<MaintenanceJob>(QUEUE_NAMES.MAINTENANCE, processMaintenanceJob, {
    connection,
    concurrency: 1,
  });

  for (const worker of [assessmentWorker, reportWorker, maintenanceWorker]) {
    worker.on('failed', (job, err) => {
      const unavailable = err instanceof LLMUnavailableError || err.name === 'LLMUnavailableError';
      logger.warn(
        { jobId: job?.id, queue: worker.name, attempt: job?.attemptsMade, err: err.message, unavailable },
        unavailable ? 'задача отложена: LLM недоступна' : 'задача завершилась ошибкой',
      );
    });
    worker.on('error', (err) => logger.error({ err, queue: worker.name }, 'ошибка worker'));
  }

  await scheduleMaintenance();
  logger.info(
    { concurrency: env.LLM_MAX_CONCURRENCY, provider: env.LLM_PROVIDER },
    'worker запущен',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'остановка worker');
    await Promise.all([assessmentWorker.close(), reportWorker.close(), maintenanceWorker.close()]);
    await prisma.$disconnect();
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (err) => {
  logger.error({ err }, 'критическая ошибка worker');
  await prisma.$disconnect();
  process.exit(1);
});
