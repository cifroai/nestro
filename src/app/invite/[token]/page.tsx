import { InvitePage } from './InvitePage.js';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-graphite-50">
      <InvitePage token={token} />
    </div>
  );
}
