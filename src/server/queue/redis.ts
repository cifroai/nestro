import Redis from 'ioredis';
import { getEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';

/**
 * Redis используется для очередей (BullMQ) и rate limit.
 * Недоступность Redis не должна ломать прохождение теста: очереди
 * деградируют к статусу PENDING (docs/LLM_ASSESSMENT.md §5.2).
 */
let client: Redis | null = null;
let availability: { checkedAt: number; ok: boolean } = { checkedAt: 0, ok: false };

export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
  void client.connect().catch(() => undefined);
  return client;
}

const AVAILABILITY_TTL_MS = 5_000;

export async function isRedisAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - availability.checkedAt < AVAILABILITY_TTL_MS) return availability.ok;
  try {
    const pong = await getRedis().ping();
    availability = { checkedAt: now, ok: pong === 'PONG' };
  } catch {
    availability = { checkedAt: now, ok: false };
  }
  return availability.ok;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
  availability = { checkedAt: 0, ok: false };
}
