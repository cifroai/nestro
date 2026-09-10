import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { generateToken } from '../auth/tokens.js';
import { revokeAllUserSessions } from '../auth/session.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import { ROLES, type RoleCode } from '../auth/permissions.js';

/** Управление пользователями и ролями (§42). Все изменения журналируются. */

export interface ActorContext {
  userId: string;
  ip?: string | null;
  requestId?: string | null;
}

export async function listUsers() {
  return prisma.user.findMany({
    include: { roles: { include: { role: { select: { code: true, title: true } } } } },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
  });
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  roleCodes: RoleCode[];
  password?: string;
}

export async function createUser(input: CreateUserInput, actor: ActorContext) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('Пользователь с таким адресом уже существует');

  if (input.roleCodes.includes(ROLES.CANDIDATE)) {
    throw badRequest('Роль «Кандидат» не назначается сотрудникам: кандидаты работают по приглашению');
  }

  const roles = await prisma.role.findMany({ where: { code: { in: input.roleCodes } } });
  if (roles.length !== input.roleCodes.length) throw badRequest('Указана неизвестная роль');

  const password = input.password ?? generateToken(12);
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      fullName: input.fullName.trim(),
      passwordHash,
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
    include: { roles: { include: { role: true } } },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    entity: 'User',
    entityId: user.id,
    actorUserId: actor.userId,
    newValue: { email, fullName: user.fullName, roles: input.roleCodes },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  // Пароль возвращается один раз: в БД хранится только хэш.
  return { user, generatedPassword: input.password ? null : password };
}

export async function updateUserRoles(
  userId: string,
  roleCodes: RoleCode[],
  actor: ActorContext,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw notFound('Пользователь не найден');

  const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
  if (roles.length !== roleCodes.length) throw badRequest('Указана неизвестная роль');

  const previous = user.roles.map((r) => r.role.code);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({ data: roles.map((role) => ({ userId, roleId: role.id })) }),
  ]);

  // Изменение прав немедленно вступает в силу: активные сессии отзываются.
  await revokeAllUserSessions(userId);

  await recordAudit({
    action: AUDIT_ACTIONS.USER_ROLES_CHANGED,
    entity: 'User',
    entityId: userId,
    actorUserId: actor.userId,
    oldValue: { roles: previous },
    newValue: { roles: roleCodes, sessionsRevoked: true },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export async function setUserActive(
  userId: string,
  isActive: boolean,
  actor: ActorContext,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Пользователь не найден');
  if (userId === actor.userId && !isActive) {
    throw badRequest('Нельзя деактивировать собственную учётную запись');
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });
  if (!isActive) await revokeAllUserSessions(userId);

  await recordAudit({
    action: AUDIT_ACTIONS.USER_UPDATED,
    entity: 'User',
    entityId: userId,
    actorUserId: actor.userId,
    oldValue: { isActive: user.isActive },
    newValue: { isActive },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export async function resetPassword(
  userId: string,
  actor: ActorContext,
): Promise<{ password: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Пользователь не найден');

  const password = generateToken(12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null },
  });
  await revokeAllUserSessions(userId);

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entity: 'User',
    entityId: userId,
    actorUserId: actor.userId,
    newValue: { reset: true, byAdmin: true, sessionsRevoked: true },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return { password };
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  actor: ActorContext,
): Promise<void> {
  const { verifyPassword } = await import('../auth/password.js');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Пользователь не найден');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('Текущий пароль указан неверно');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entity: 'User',
    entityId: userId,
    actorUserId: actor.userId,
    newValue: { self: true },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export async function listRoles() {
  return prisma.role.findMany({
    include: { permissions: { include: { permission: { select: { code: true, description: true } } } } },
    orderBy: { code: 'asc' },
  });
}
