/**
 * Создание учётной записи администратора.
 * Пароль задаётся через stdin или переменную ADMIN_PASSWORD; в аргументах
 * командной строки пароль не передаётся (он попал бы в историю оболочки).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/server/db/prisma.js';
import { hashPassword } from '../src/server/auth/password.js';
import { ROLES } from '../src/server/auth/permissions.js';
import { AUDIT_ACTIONS, recordAudit } from '../src/server/services/auditService.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email');
  const fullName = arg('name') ?? 'Администратор';
  const roleCode = arg('role') ?? ROLES.SUPER_ADMIN;
  if (!email) throw new Error('Укажите --email');

  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');

  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`Роль ${roleCode} не найдена. Сначала выполните npm run db:seed`);

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, isActive: true, fullName },
    create: { email: email.toLowerCase(), fullName, passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    entity: 'User',
    entityId: user.id,
    actorKind: 'SYSTEM',
    actorLabel: 'createAdmin script',
    newValue: { email: user.email, role: roleCode },
  });

  process.stdout.write(`Пользователь ${user.email} создан с ролью ${roleCode}\n`);
  if (generated) process.stdout.write(`Сгенерированный пароль: ${password}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    process.stderr.write(`${String(err)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
