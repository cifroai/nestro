import { buildRequestContext } from '@/server/http/context.js';
import { PERMISSIONS } from '@/server/auth/permissions.js';
import { ReportView } from './ReportView.js';

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await buildRequestContext();
  const canReview = Boolean(ctx.user?.permissions.includes(PERMISSIONS.REVIEW_WRITE));
  return <ReportView candidateId={id} canReview={canReview} />;
}
