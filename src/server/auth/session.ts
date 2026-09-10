import { prisma } from '../db/prisma.js';
import { generateToken, hashToken, hashUserAgent } from './tokens.js';
import { verifyPassword } from './password.js';
import { ROLE_PERMISSIONS, type Permission, type RoleCode } from './permissions.js';
import { AUDIT_ACTIONS, recordAudit } from '../services/auditService.js';
import { forbidden, unauthenticated } from '../http/errors.js';

export const STAFF_COOKIE = 'nestro_sid';
export const CANDIDATE_COOKIE = 'nestro_cand';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа неактивности
const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleCode[];
  permissions: Permission[];
  sessionId: string;
  csrfSecret: string;
}

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}

function permissionsForRoles(roles: RoleCode[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set];
}

export async function login(
  email: string,
  password: string,
  ctx: LoginContext = {},
): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { roles: { include: { role: true } } },
  });

  // Единое сообщение и одинаковая работа при отсутствии пользователя —
  // чтобы не раскрывать существование учётной записи.
  if (!user || !user.isActive) {
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      entity: 'User',
      entityId: user?.id ?? null,
      actorKind: 'SYSTEM',
      actorLabel: normalizedEmail,
      newValue: { reason: user ? 'inactive' : 'unknown_email' },
      ip: ctx.ip ?? null,
      requestId: ctx.requestId ?? null,
    });
    throw unauthenticated('Неверный адрес электронной почты или пароль');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw forbidden('Учётная запись временно заблокирована из-за неудачных попыток входа');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      entity: 'User',
      entityId: user.id,
      actorKind: 'SYSTEM',
      actorLabel: normalizedEmail,
      newValue: { reason: 'bad_password', failedLogins: failed },
      ip: ctx.ip ?? null,
      requestId: ctx.requestId ?? null,
    });
    throw unauthenticated('Неверный адрес электронной почты или пароль');
  }

  const token = generateToken(32);
  const csrfSecret = generateToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      csrfSecret,
      ip: ctx.ip ?? null,
      userAgentHash: hashUserAgent(ctx.userAgent),
      expiresAt,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const roles = user.roles.map((r) => r.role.code as RoleCode);
  await recordAudit({
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entity: 'Session',
    entityId: session.id,
    actorUserId: user.id,
    newValue: { roles },
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions: permissionsForRoles(roles),
      sessionId: session.id,
      csrfSecret,
    },
  };
}

export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  if (!session || session.revokedAt) return null;

  const now = new Date();
  if (session.expiresAt <= now) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_TTL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return null;
  }
  if (!session.user.isActive) return null;

  // Обновляем lastSeenAt не чаще раза в минуту, чтобы не грузить БД.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  const roles = session.user.roles.map((r) => r.role.code as RoleCode);
  return {
    id: session.user.id,
    email: session.user.email,
    fullName: session.user.fullName,
    roles,
    permissions: permissionsForRoles(roles),
    sessionId: session.id,
    csrfSecret: session.csrfSecret,
  };
}

export async function logout(token: string | undefined, ctx: LoginContext = {}): Promise<void> {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await recordAudit({
    action: AUDIT_ACTIONS.LOGOUT,
    entity: 'Session',
    entityId: session.id,
    actorUserId: session.userId,
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export function sessionCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export { permissionsForRoles, SESSION_TTL_MS, IDLE_TTL_MS };
