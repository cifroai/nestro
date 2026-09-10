import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { notFound } from '@/server/http/errors.js';
import { reportFile } from '@/server/services/exportService.js';
import { getObject } from '@/server/services/storageService.js';

/**
 * Выдача файла отчёта. Файлы не публикуются: доступ только через API
 * с проверкой прав (docs/SECURITY.md T16).
 */
export const GET = withRoute<undefined, undefined, { id: string }>(
  { actor: 'staff', permission: PERMISSIONS.REPORT_READ },
  async ({ params }) => {
    const record = await reportFile(params.id);
    if (!record.storageKey) throw notFound('Файл отчёта не найден');
    const body = await getObject(record.storageKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="report-${params.id}.pdf"`,
        'cache-control': 'private, no-store',
      },
    });
  },
);
