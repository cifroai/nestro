import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque-токены: клиенту выдаётся 32 байта CSPRNG в base64url,
 * в БД хранится только SHA-256 (docs/SECURITY.md §T3, §3).
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Сравнение за постоянное время (защита от timing-атак). */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  return createHash('sha256').update(userAgent).digest('hex').slice(0, 32);
}
