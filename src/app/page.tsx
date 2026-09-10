import { redirect } from 'next/navigation';
import { buildRequestContext } from '@/server/http/context.js';

export default async function RootPage() {
  const ctx = await buildRequestContext();
  redirect(ctx.user ? '/dashboard' : '/login');
}
