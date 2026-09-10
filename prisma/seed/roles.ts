import type { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  ROLE_TITLES,
  ROLES,
  type RoleCode,
} from '../../src/server/auth/permissions.js';

/**
 * Идемпотентный seed ролей и прав. Права — из единственного источника истины
 * src/server/auth/permissions.ts, чтобы БД и проверки не расходились.
 */
export async function seedRolesAndPermissions(prisma: PrismaClient): Promise<void> {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { description: PERMISSION_DESCRIPTIONS[code] },
      create: { code, description: PERMISSION_DESCRIPTIONS[code] },
    });
  }

  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
  );

  for (const roleCode of Object.values(ROLES) as RoleCode[]) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: { title: ROLE_TITLES[roleCode] },
      create: { code: roleCode, title: ROLE_TITLES[roleCode], isSystem: true },
    });

    const desired = ROLE_PERMISSIONS[roleCode] ?? [];
    // Приводим набор прав роли к декларации: удаляем лишние, добавляем недостающие.
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permission: { code: { notIn: desired.length ? [...desired] : ['__none__'] } },
      },
    });
    for (const permCode of desired) {
      const permissionId = permissionIds.get(permCode);
      if (!permissionId) throw new Error(`Право ${permCode} не найдено в БД`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}
