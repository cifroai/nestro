import { type z } from 'zod';
import { withRoute } from '@/server/http/route.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { auditListSchema } from '@/server/validation/common.js';
import { listAudit } from '@/server/services/auditService.js';

/** Журнал аудита (§43): только чтение, записи неизменяемы. */
export const GET = withRoute<undefined, z.infer<typeof auditListSchema>>(
  { actor: 'staff', permission: PERMISSIONS.AUDIT_READ, querySchema: auditListSchema },
  async ({ query }) => listAudit(query),
);
