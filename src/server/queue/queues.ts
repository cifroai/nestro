import { Queue, type JobsOptions } from 'bullmq';
import { getEnv } from '../config/env.js';
import { getRedis, isRedisAvailable } from './redis.js';
import { logger } from '../logging/logger.js';

/**
 * Очереди фоновых задач (docs/ARCHITECTURE.md ADR-5).
 *
 * Постановка задачи никогда не является условием сохранности данных:
 * статус TestSession.assessmentStatus = PENDING гарантирует, что оценка
 * будет выполнена после восстановления Redis или LLM (§74).
 */

export const QUEUE_NAMES = {
  ASSESSMENT: 'nestro-assessment',
  REPORT: 'nestro-report',
  MAINTENANCE: 'nestro-maintenance',
} as const;

export type SessionAssessmentJob = {
  type: 'SESSION_ASSESSMENT';
  sessionId: string;
};

export type AnswerEvaluationJob = {
  type: 'ANSWER_EVALUATION';
  answerId: string;
  evaluatorRole: 'A' | 'B';
};

export type FinalizeScoringJob = {
  type: 'FINALIZE_SCORING';
  sessionId: string;
  reason: 'INITIAL' | 'HUMAN_REVIEW' | 'RECOMPUTE';
  actorUserId?: string;
};

export type InterviewQuestionsJob = {
  type: 'INTERVIEW_QUESTIONS';
  sessionId: string;
};

export type AssessmentJob =
  | SessionAssessmentJob
  | AnswerEvaluationJob
  | FinalizeScoringJob
  | InterviewQuestionsJob;

export type ReportJob = { type: 'GENERATE_PDF'; sessionId: string; requestedByUserId: string };

export type MaintenanceJob =
  | { type: 'RETRY_PENDING_ASSESSMENTS' }
  | { type: 'EXPIRE_SESSIONS' }
  | { type: 'RETENTION' }
  | { type: 'QUESTION_STATS' };

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

let assessmentQueue: Queue<AssessmentJob> | null = null;
let reportQueue: Queue<ReportJob> | null = null;
let maintenanceQueue: Queue<MaintenanceJob> | null = null;

export function getAssessmentQueue(): Queue<AssessmentJob> {
  assessmentQueue ??= new Queue<AssessmentJob>(QUEUE_NAMES.ASSESSMENT, { connection: getRedis() });
  return assessmentQueue;
}

export function getReportQueue(): Queue<ReportJob> {
  reportQueue ??= new Queue<ReportJob>(QUEUE_NAMES.REPORT, { connection: getRedis() });
  return reportQueue;
}

export function getMaintenanceQueue(): Queue<MaintenanceJob> {
  maintenanceQueue ??= new Queue<MaintenanceJob>(QUEUE_NAMES.MAINTENANCE, { connection: getRedis() });
  return maintenanceQueue;
}

/** Идемпотентная постановка оценки сессии: повтор не создаёт дублей. */
export async function enqueueSessionAssessment(sessionId: string): Promise<boolean> {
  if (!(await isRedisAvailable())) {
    logger.warn({ sessionId }, 'redis недоступен: оценка останется в статусе PENDING');
    return false;
  }
  await getAssessmentQueue().add(
    'session-assessment',
    { type: 'SESSION_ASSESSMENT', sessionId },
    { ...DEFAULT_JOB_OPTIONS, jobId: `session:${sessionId}` },
  );
  return true;
}

export async function enqueueAnswerEvaluation(
  answerId: string,
  evaluatorRole: 'A' | 'B',
): Promise<boolean> {
  if (!(await isRedisAvailable())) return false;
  await getAssessmentQueue().add(
    'answer-evaluation',
    { type: 'ANSWER_EVALUATION', answerId, evaluatorRole },
    { ...DEFAULT_JOB_OPTIONS, jobId: `answer:${answerId}:${evaluatorRole}` },
  );
  return true;
}

export async function enqueueFinalizeScoring(
  sessionId: string,
  reason: FinalizeScoringJob['reason'],
  actorUserId?: string,
): Promise<boolean> {
  if (!(await isRedisAvailable())) return false;
  await getAssessmentQueue().add(
    'finalize-scoring',
    {
      type: 'FINALIZE_SCORING',
      sessionId,
      reason,
      ...(actorUserId ? { actorUserId } : {}),
    },
    {
      ...DEFAULT_JOB_OPTIONS,
      // Пересчёт может выполняться многократно: id включает причину и время.
      jobId: `finalize:${sessionId}:${reason}:${Date.now()}`,
    },
  );
  return true;
}

export async function enqueueInterviewQuestions(sessionId: string): Promise<boolean> {
  if (!(await isRedisAvailable())) return false;
  await getAssessmentQueue().add(
    'interview-questions',
    { type: 'INTERVIEW_QUESTIONS', sessionId },
    { ...DEFAULT_JOB_OPTIONS, jobId: `interview:${sessionId}:${Date.now()}` },
  );
  return true;
}

export async function enqueuePdfReport(
  sessionId: string,
  requestedByUserId: string,
): Promise<boolean> {
  if (!(await isRedisAvailable())) return false;
  await getReportQueue().add(
    'generate-pdf',
    { type: 'GENERATE_PDF', sessionId, requestedByUserId },
    { ...DEFAULT_JOB_OPTIONS, attempts: 3, jobId: `pdf:${sessionId}:${Date.now()}` },
  );
  return true;
}

/** Периодические задачи обслуживания. */
export async function scheduleMaintenance(): Promise<void> {
  if (!(await isRedisAvailable())) return;
  const queue = getMaintenanceQueue();
  const repeatable: Array<{ name: string; job: MaintenanceJob; pattern: string }> = [
    { name: 'retry-pending', job: { type: 'RETRY_PENDING_ASSESSMENTS' }, pattern: '*/10 * * * *' },
    { name: 'expire-sessions', job: { type: 'EXPIRE_SESSIONS' }, pattern: '5 * * * *' },
    { name: 'retention', job: { type: 'RETENTION' }, pattern: '30 3 * * *' },
    { name: 'question-stats', job: { type: 'QUESTION_STATS' }, pattern: '0 4 * * *' },
  ];
  for (const item of repeatable) {
    await queue.add(item.name, item.job, {
      ...DEFAULT_JOB_OPTIONS,
      repeat: { pattern: item.pattern },
      jobId: `maintenance:${item.name}`,
    });
  }
}

export async function queueDepths(): Promise<Record<string, number>> {
  if (!(await isRedisAvailable())) return {};
  const [assessment, report] = await Promise.all([
    getAssessmentQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
    getReportQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
  ]);
  return {
    assessmentWaiting: assessment.waiting ?? 0,
    assessmentActive: assessment.active ?? 0,
    assessmentDelayed: assessment.delayed ?? 0,
    assessmentFailed: assessment.failed ?? 0,
    reportWaiting: report.waiting ?? 0,
    reportFailed: report.failed ?? 0,
  };
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    assessmentQueue?.close(),
    reportQueue?.close(),
    maintenanceQueue?.close(),
  ]);
  assessmentQueue = null;
  reportQueue = null;
  maintenanceQueue = null;
}

export const llmConcurrency = (): number => getEnv().LLM_MAX_CONCURRENCY;
export { DEFAULT_JOB_OPTIONS };
