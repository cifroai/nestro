import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { exportSchema } from '@/server/validation/common.js';
import { exportAggregates } from '@/server/services/exportService.js';

export const GET = withRoute<undefined, z.infer<typeof exportSchema>>(
  {
    actor: 'staff',
    permission: PERMISSIONS.ANALYTICS_EXPORT,
    querySchema: exportSchema,
    rateLimit: { rule: 'EXPORT' },
  },
  async ({ query, ctx }) => {
    const file = await exportAggregates(query.format, query, {
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
