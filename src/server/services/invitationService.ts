import { createHmac } from 'node:crypto';
import type { InvitationStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { badRequest, conflict, gone, notFound } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import type { ActorContext } from './assessmentService.js';

/**
 * Приглашения (§54). Токен одноразовый, в БД хранится только его хэш;
 * сам токен возвращается вызывающей стороне ровно один раз.
 */

const MAX_DEADLINE_DAYS = 90;

/**
 * Токен = случайные 32 байта + HMAC-метка на INVITATION_SECRET.
 * Метка позволяет отбросить заведомо чужие значения без обращения к БД,
 * что снижает стоимость перебора; проверка подлинности — по хэшу в БД.
 */
function signToken(raw: string): string {
  const mac = createHmac('sha256', getEnv().INVITATION_SECRET).update(raw).digest('base64url').slice(0, 16);
  return `${raw}.${mac}`;
}

function verifyTokenShape(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [raw, mac] = parts as [string, string];
  const expected = createHmac('sha256', getEnv().INVITATION_SECRET).update(raw).digest('base64url').slice(0, 16);
  return mac === expected;
}

export interface CreateInvitationInput {
  fullName: string;
  email?: string | null;
  positionCode: string;
  assessmentVersionId: string;
  expiresAt: Date;
  maxAttempts?: number;
  experienceYears?: number | null;
  sourceChannel?: string | null;
  candidateId?: string | null;
}

export interface CreatedInvitation {
  id: string;
  candidateId: string;
  status: InvitationStatus;
  expiresAt: Date;
  /** Полная ссылка. Отображается один раз и не хранится в открытом виде. */
  url: string;
}

export async function createInvitation(
  input: CreateInvitationInput,
  actor: ActorContext,
): Promise<CreatedInvitation> {
  const now = Date.now();
  if (input.expiresAt.getTime() <= now) {
    throw badRequest('Срок действия приглашения должен быть в будущем');
  }
  if (input.expiresAt.getTime() - now > MAX_DEADLINE_DAYS * 86_400_000) {
    throw badRequest(`Срок действия приглашения не может превышать ${MAX_DEADLINE_DAYS} дней`);
  }

  const version = await prisma.assessmentVersion.findUnique({
    where: { id: input.assessmentVersionId },
    include: { assessment: { include: { position: true } } },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');
  if (version.status !== 'PUBLISHED') {
    throw conflict('Приглашение возможно только на опубликованную версию ассессмента');
  }
  if (version.assessment.position.code !== input.positionCode) {
    throw badRequest('Версия ассессмента не соответствует указанной должности');
  }

  const position = version.assessment.position;

  const candidate = input.candidateId
    ? await prisma.candidate.findUniqueOrThrow({ where: { id: input.candidateId } })
    : await prisma.candidate.create({
        data: {
          fullName: input.fullName.trim(),
          email: input.email?.trim().toLowerCase() ?? null,
          positionId: position.id,
          experienceYears: input.experienceYears ?? null,
          sourceChannel: input.sourceChannel ?? null,
        },
      });

  const raw = generateToken(32);
  const token = signToken(raw);

  const invitation = await prisma.invitation.create({
    data: {
      candidateId: candidate.id,
      assessmentVersionId: version.id,
      tokenHash: hashToken(token),
      expiresAt: input.expiresAt,
      maxAttempts: input.maxAttempts ?? 1,
      createdByUserId: actor.userId,
      status: 'CREATED',
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.INVITATION_CREATED,
    entity: 'Invitation',
    entityId: invitation.id,
    actorUserId: actor.userId,
    newValue: {
      candidateId: candidate.id,
      positionCode: position.code,
      assessmentVersionId: version.id,
      expiresAt: input.expiresAt.toISOString(),
      maxAttempts: invitation.maxAttempts,
    },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return {
    id: invitation.id,
    candidateId: candidate.id,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    url: `${getEnv().APP_URL.replace(/\/+$/, '')}/invite/${token}`,
  };
}

export interface InvitationPublicView {
  invitationId: string;
  positionTitle: string;
  positionDescription: string | null;
  assessmentTitle: string;
  expiresAt: Date;
  status: InvitationStatus;
  candidateName: string;
  /** Ориентировочная структура теста для страницы приглашения (§25). */
  structure: Array<{ section: string; title: string; description: string; approxMinutes: number }>;
  totalApproxMinutes: number;
  rules: string[];
  attemptsLeft: number;
  existingSessionId: string | null;
}

const SECTION_INFO: Record<string, { title: string; description: string; minutesPerItem: number }> = {
  KELLY_TRIADS: {
    title: 'Профессиональные критерии оценки',
    description:
      'Вы сравниваете специалистов и формулируете собственные критерии профессиональной эффективности.',
    minutesPerItem: 6,
  },
  REPERTORY_GRID: {
    title: 'Оценка специалистов по вашим критериям',
    description: 'Вы оцениваете каждого специалиста по сформулированным вами критериям.',
    minutesPerItem: 10,
  },
  LADDERING: {
    title: 'Уточнение значимости критериев',
    description: 'Несколько уточняющих вопросов о том, почему выбранные критерии важны.',
    minutesPerItem: 8,
  },
  SJT_CASES: {
    title: 'Профессиональные ситуационные кейсы',
    description:
      'Производственные ситуации с динамикой параметров. Часть данных раскрывается после вашего первого решения.',
    minutesPerItem: 12,
  },
  ARGUMENTATION: {
    title: 'Профессиональная аргументация',
    description: 'Открытые вопросы о взаимосвязях и о вашем опыте.',
    minutesPerItem: 9,
  },
  SELF_RATING: {
    title: 'Самооценка',
    description: 'Оценка собственного уровня по направлениям с обоснованием примерами.',
    minutesPerItem: 8,
  },
};

export const CANDIDATE_RULES = [
  'Тестирование проходится самостоятельно, без ограничения по времени на отдельный вопрос.',
  'Ответы сохраняются на сервере автоматически: вы можете закрыть браузер и продолжить позже с того же места.',
  'Ссылка одноразовая и действует до указанного срока.',
  'Правильных ответов в привычном смысле нет: оценивается структура вашего инженерного рассуждения.',
  'Фамилии реальных коллег указывать не требуется.',
  'Доступ к веб-камере и микрофону не запрашивается.',
];

/** Публичное представление приглашения; переводит статус в OPENED. */
export async function openInvitation(
  token: string,
  ctx: { ip?: string | null } = {},
): Promise<InvitationPublicView> {
  if (!verifyTokenShape(token)) throw notFound('Приглашение не найдено');

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      candidate: true,
      version: {
        include: {
          assessment: { include: { position: true } },
          questionVersions: { where: { isActive: true }, select: { section: true } },
        },
      },
      sessions: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!invitation) throw notFound('Приглашение не найдено');

  if (invitation.expiresAt <= new Date()) {
    if (invitation.status !== 'EXPIRED') {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    }
    throw gone('Срок действия приглашения истёк. Обратитесь к организатору тестирования.');
  }

  const completed = invitation.sessions.find((s) => s.status === 'COMPLETED');
  const inProgress = invitation.sessions.find((s) => s.status === 'IN_PROGRESS' || s.status === 'NOT_STARTED');

  if (!completed && invitation.status === 'CREATED') {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'OPENED', openedAt: invitation.openedAt ?? new Date() },
    });
  } else if (!completed && invitation.status === 'SENT') {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'OPENED', openedAt: new Date() },
    });
  }

  const counts = new Map<string, number>();
  for (const qv of invitation.version.questionVersions) {
    counts.set(qv.section, (counts.get(qv.section) ?? 0) + 1);
  }

  const structure = [...counts.entries()]
    .filter(([section]) => SECTION_INFO[section])
    .map(([section, count]) => {
      const info = SECTION_INFO[section] as { title: string; description: string; minutesPerItem: number };
      // Kelly-триад в банке больше, чем задаётся кандидату: показываем целевое число.
      const shown = section === 'KELLY_TRIADS' ? Math.min(count, invitation.version.targetConstructCount + 2) : count;
      return {
        section,
        title: info.title,
        description: info.description,
        approxMinutes: shown * info.minutesPerItem,
      };
    });

  // Лестница смыслов формируется динамически и не имеет отдельных вопросов в банке.
  if (!structure.some((s) => s.section === 'LADDERING')) {
    const info = SECTION_INFO.LADDERING as { title: string; description: string; minutesPerItem: number };
    const idx = structure.findIndex((s) => s.section === 'SJT_CASES');
    const entry = {
      section: 'LADDERING',
      title: info.title,
      description: info.description,
      approxMinutes: invitation.version.ladderConstructCount * info.minutesPerItem,
    };
    if (idx >= 0) structure.splice(idx, 0, entry);
    else structure.push(entry);
  }

  await recordAudit({
    action: 'invitation.opened',
    entity: 'Invitation',
    entityId: invitation.id,
    actorKind: 'CANDIDATE',
    actorLabel: invitation.candidateId,
    ip: ctx.ip ?? null,
  });

  return {
    invitationId: invitation.id,
    positionTitle: invitation.version.assessment.position.title,
    positionDescription: invitation.version.assessment.position.description,
    assessmentTitle: invitation.version.assessment.title,
    expiresAt: invitation.expiresAt,
    status: completed ? 'COMPLETED' : 'OPENED',
    candidateName: invitation.candidate.fullName,
    structure,
    totalApproxMinutes: structure.reduce((acc, s) => acc + s.approxMinutes, 0),
    rules: CANDIDATE_RULES,
    attemptsLeft: Math.max(0, invitation.maxAttempts - invitation.attemptsUsed),
    existingSessionId: inProgress?.id ?? null,
  };
}

/** Разрешение токена в приглашение для старта сессии. */
export async function resolveInvitationForStart(token: string) {
  if (!verifyTokenShape(token)) throw notFound('Приглашение не найдено');
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      candidate: true,
      version: { include: { assessment: { include: { position: true } } } },
      sessions: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!invitation) throw notFound('Приглашение не найдено');
  if (invitation.expiresAt <= new Date()) throw gone('Срок действия приглашения истёк');
  return invitation;
}

export async function markInvitationStatus(
  invitationId: string,
  status: InvitationStatus,
): Promise<void> {
  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      status,
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  });
}

export interface InvitationListQuery {
  status?: InvitationStatus;
  positionCode?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listInvitations(query: InvitationListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      include: {
        candidate: { select: { id: true, fullName: true, email: true, position: { select: { title: true, code: true } } } },
        version: { select: { id: true, version: true, assessment: { select: { title: true } } } },
        sessions: { select: { id: true, status: true, assessmentStatus: true, completedAt: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Перевыпуск приглашения: старый токен инвалидируется. */
export async function resendInvitation(
  invitationId: string,
  actor: ActorContext,
  newExpiresAt?: Date,
): Promise<{ url: string; expiresAt: Date }> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    include: { sessions: { select: { status: true } } },
  });
  if (!invitation) throw notFound('Приглашение не найдено');
  if (invitation.sessions.some((s) => s.status === 'COMPLETED')) {
    throw conflict('Тестирование по этому приглашению уже завершено');
  }

  const raw = generateToken(32);
  const token = signToken(raw);
  const expiresAt = newExpiresAt ?? invitation.expiresAt;
  if (expiresAt <= new Date()) throw badRequest('Новый срок действия должен быть в будущем');

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { tokenHash: hashToken(token), expiresAt, status: 'SENT', sentAt: new Date() },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.INVITATION_RESENT,
    entity: 'Invitation',
    entityId: invitationId,
    actorUserId: actor.userId,
    newValue: { expiresAt: expiresAt.toISOString(), previousTokenInvalidated: true },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return { url: `${getEnv().APP_URL.replace(/\/+$/, '')}/invite/${token}`, expiresAt };
}

export async function cancelInvitation(invitationId: string, actor: ActorContext): Promise<void> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw notFound('Приглашение не найдено');
  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'EXPIRED', expiresAt: new Date() },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.INVITATION_CANCELLED,
    entity: 'Invitation',
    entityId: invitationId,
    actorUserId: actor.userId,
    oldValue: { status: invitation.status },
    newValue: { status: 'EXPIRED' },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export async function markSent(invitationId: string): Promise<void> {
  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'SENT', sentAt: new Date() },
  });
}
