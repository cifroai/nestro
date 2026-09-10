import { prisma } from '../db/prisma.js';
import type { Tx } from '../db/prisma.js';
import { logger } from '../logging/logger.js';

/**
 * Журнал аудита (§43). Append-only: сервис не содержит методов изменения
 * и удаления записей. Технические логи ведутся отдельно.
 */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password.changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ROLES_CHANGED: 'user.roles.changed',
  ASSESSMENT_CREATED: 'assessment.created',
  VERSION_CREATED: 'assessment_version.created',
  VERSION_CLONED: 'assessment_version.cloned',
  VERSION_PUBLISHED: 'assessment_version.published',
  WEIGHTS_UPDATED: 'assessment_version.weights.updated',
  THRESHOLDS_UPDATED: 'assessment_version.thresholds.updated',
  QUESTION_UPDATED: 'question.updated',
  RUBRIC_UPDATED: 'rubric.updated',
  SCENARIO_UPDATED: 'scenario.updated',
  PROMPT_UPDATED: 'prompt_template.updated',
  SCORING_MODEL_UPDATED: 'scoring_model.updated',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_CANCELLED: 'invitation.cancelled',
  SESSION_STARTED: 'test_session.started',
  SESSION_COMPLETED: 'test_session.completed',
  SCORING_COMPUTED: 'scoring.computed',
  SCORING_RECOMPUTED: 'scoring.recomputed',
  REVIEW_SUBMITTED: 'review.submitted',
  REPORT_GENERATED: 'report.generated',
  PII_EXPORTED: 'candidate.pii.exported',
  CANDIDATE_ANONYMIZED: 'candidate.anonymized',
  EMPLOYMENT_OUTCOME_RECORDED: 'employment_outcome.recorded',
  BENCHMARK_UPDATED: 'benchmark.updated',
  ANALYTICS_EXPORTED: 'analytics.exported',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction | string;
  entity: string;
  entityId?: string | null;
  actorUserId?: string | null;
  actorKind?: 'USER' | 'CANDIDATE' | 'SYSTEM';
  actorLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

function normalize(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as object;
}

export async function recordAudit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const client = tx ?? prisma;
  try {
    await client.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorKind: entry.actorKind ?? 'USER',
        actorLabel: entry.actorLabel ?? null,
        oldValue: normalize(entry.oldValue),
        newValue: normalize(entry.newValue),
        ip: entry.ip ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (err) {
    // Отказ аудита не должен ронять бизнес-операцию, но обязан быть виден.
    logger.error({ err, action: entry.action, entity: entry.entity }, 'audit write failed');
    if (!tx) return;
    throw err;
  }
}

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listAudit(query: AuditQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const where = {
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: { contains: query.action } } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
