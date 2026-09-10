import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { publishVersion } from '@/server/services/assessmentService.js';

/** Публикация версии делает её неизменяемой (§32, §36). */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_VERSION_PUBLISH },
  async ({ params, ctx }) => {
    await publishVersion(params.id, { userId: ctx.user!.id, ip: ctx.ip, requestId: ctx.requestId });
    return {
      published: true,
      note: 'Версия зафиксирована. Дальнейшие изменения возможны только в новой версии.',
    };
  },
);
