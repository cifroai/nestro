import { getEnv } from '../config/env.js';
import { getRedis, isRedisAvailable } from '../queue/redis.js';
import { rateLimited } from './errors.js';

/**
 * Sliding-window rate limit на Redis (docs/SECURITY.md §6).
 * При недоступности Redis используется in-memory fallback: он защищает
 * одиночный инстанс и не «открывает» лимиты полностью.
 */
export interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  LOGIN: { limit: 5, windowSeconds: 900 },
  INVITE_EXCHANGE: { limit: 10, windowSeconds: 3600 },
  ANSWER_SAVE: { limit: 240, windowSeconds: 60 },
  EXPORT: { limit: 10, windowSeconds: 3600 },
  DEFAULT_WRITE: { limit: 120, windowSeconds: 60 },
} as const;

const memory = new Map<string, number[]>();

function memoryConsume(rule: RateLimitRule, now: number): boolean {
  const windowStart = now - rule.windowSeconds * 1000;
  const hits = (memory.get(rule.key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= rule.limit) {
    memory.set(rule.key, hits);
    return false;
  }
  hits.push(now);
  memory.set(rule.key, hits);
  return true;
}

export async function consumeRateLimit(rule: RateLimitRule): Promise<void> {
  if (getEnv().DISABLE_RATE_LIMIT) return;
  const now = Date.now();

  if (await isRedisAvailable()) {
    const redis = getRedis();
    const key = `rl:${rule.key}`;
    const windowStart = now - rule.windowSeconds * 1000;
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
    pipeline.zcard(key);
    pipeline.expire(key, rule.windowSeconds + 1);
    const results = await pipeline.exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    if (count > rule.limit) throw rateLimited();
    return;
  }

  if (!memoryConsume(rule, now)) throw rateLimited();
}

/** Только для тестов. */
export function resetMemoryRateLimit(): void {
  memory.clear();
}
