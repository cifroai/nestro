import { prisma } from '../db/prisma.js';
import { generateToken, hashToken, hashUserAgent } from './tokens.js';
import { forbidden, gone, notFound } from '../http/errors.js';

/**
 * Кандидатская сессия доступа. Отдельный namespace от staff-сессии (T1/T2):
 * даёт права строго на собственную TestSession и не открывает админ-API.
 */
export const CANDIDATE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface CandidatePrincipal {
  testSessionId: string;
  candidateId: string;
  assessmentVersionId: string;
  csrfSecret: string;
  tokenId: string;
}

export async function issueCandidateToken(
  testSessionId: string,
  ctx: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + CANDIDATE_SESSION_TTL_MS);
  await prisma.candidateSessionToken.create({
    data: {
      sessionId: testSessionId,
      tokenHash: hashToken(token),
      csrfSecret: generateToken(24),
      ip: ctx.ip ?? null,
      userAgentHash: hashUserAgent(ctx.userAgent),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function resolveCandidate(token: string | undefined): Promise<CandidatePrincipal | null> {
  if (!token) return null;
  const record = await prisma.candidateSessionToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { testSession: { select: { id: true, candidateId: true, assessmentVersionId: true } } },
  });
  if (!record || record.revokedAt || record.expiresAt <= new Date()) return null;
  return {
    testSessionId: record.testSession.id,
    candidateId: record.testSession.candidateId,
    assessmentVersionId: record.testSession.assessmentVersionId,
    csrfSecret: record.csrfSecret,
    tokenId: record.id,
  };
}

export async function revokeCandidateTokens(testSessionId: string): Promise<void> {
  await prisma.candidateSessionToken.updateMany({
    where: { sessionId: testSessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Проверка владения сессией. Кандидат не может обратиться к чужой сессии
 * даже зная её id (docs/SECURITY.md §T1).
 */
export function assertOwnsSession(principal: CandidatePrincipal, sessionId: string): void {
  if (principal.testSessionId !== sessionId) {
    throw forbidden('Сессия недоступна');
  }
}

export async function assertSessionOpen(sessionId: string): Promise<void> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { status: true, invitation: { select: { expiresAt: true } } },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');
  if (session.status === 'COMPLETED') throw gone('Тестирование уже завершено');
  if (session.status === 'EXPIRED') throw gone('Срок прохождения тестирования истёк');
  if (session.invitation && session.invitation.expiresAt <= new Date()) {
    throw gone('Срок действия приглашения истёк');
  }
}
