import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { exportCandidateFull } from '@/server/services/exportService.js';

const querySchema = z.object({ format: z.enum(['json', 'xlsx']).default('json') });

/** Полный экспорт данных кандидата (§44). Требует отдельного права. */
export const GET = withRoute<undefined, z.infer<typeof querySchema>, { id: string }>(
  {
    actor: 'staff',
    permission: PERMISSIONS.CANDIDATE_EXPORT_PERSONAL,
    querySchema,
    rateLimit: { rule: 'EXPORT' },
  },
  async ({ params, query, ctx }) => {
    const file = await exportCandidateFull(params.id, query.format, {
      userId: ctx.user!.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  },
);
