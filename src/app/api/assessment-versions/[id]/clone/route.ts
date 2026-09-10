import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { cloneVersion } from '@/server/services/assessmentService.js';

/** Клонирование версии в новый черновик (§33). */
export const POST = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.ASSESSMENT_WRITE },
  async ({ params, ctx }) => {
    const versionId = await cloneVersion(params.id, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { versionId };
  },
);
