import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { listRoles } from '@/server/services/userService.js';

export const GET = withRoute(
  { actor: 'staff', permission: PERMISSIONS.USER_READ },
  async () => ({ items: await listRoles() }),
);
