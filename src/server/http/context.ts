import { cookies, headers } from 'next/headers';
import { STAFF_COOKIE, CANDIDATE_COOKIE, resolveSession, type AuthenticatedUser } from '../auth/session.js';
import { resolveCandidate, type CandidatePrincipal } from '../auth/candidateSession.js';
import { newRequestId } from '../logging/logger.js';

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  user: AuthenticatedUser | null;
  candidate: CandidatePrincipal | null;
}

function firstIp(forwarded: string | null): string | null {
  if (!forwarded) return null;
  const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[0] ?? null;
}

export async function buildRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const c = await cookies();
  const requestId = h.get('x-request-id') ?? newRequestId();
  const ip = firstIp(h.get('x-forwarded-for')) ?? h.get('x-real-ip') ?? null;
  const userAgent = h.get('user-agent');

  const [user, candidate] = await Promise.all([
    resolveSession(c.get(STAFF_COOKIE)?.value),
    resolveCandidate(c.get(CANDIDATE_COOKIE)?.value),
  ]);

  return { requestId, ip, userAgent, user, candidate };
}
