import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { withRoute } from '@/server/http/route.js';
import { logout, STAFF_COOKIE } from '@/server/auth/session.js';

export const POST = withRoute({ actor: 'staff' }, async ({ ctx }) => {
  const store = await cookies();
  await logout(store.get(STAFF_COOKIE)?.value, { ip: ctx.ip, requestId: ctx.requestId });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(STAFF_COOKIE);
  return response;
});
