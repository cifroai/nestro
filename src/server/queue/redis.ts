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

/**
 * Клиент настроен на БЫСТРЫЙ ОТКАЗ: при недоступности Redis команды не
 * ставятся в офлайн-очередь, а сразу отклоняются. Иначе запрос кандидата
 * (например завершение тестирования) ждал бы восстановления брокера
 * неограниченно долго, что нарушает §74.
 */
export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Команды при отсутствии соединения отклоняются немедленно.
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('error', (err) => logger.debug({ err: err.message }, 'redis недоступен'));
  void client.connect().catch(() => undefined);
  return client;
}

const AVAILABILITY_TTL_MS = 5_000;
const PING_TIMEOUT_MS = 1_500;

/** Проверка доступности с жёстким таймаутом: не блокирует вызывающий запрос. */
export async function isRedisAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - availability.checkedAt < AVAILABILITY_TTL_MS) return availability.ok;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ping = getRedis().ping();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('redis ping timeout')), PING_TIMEOUT_MS);
    });
    const pong = await Promise.race([ping, timeout]);
    availability = { checkedAt: now, ok: pong === 'PONG' };
  } catch {
    availability = { checkedAt: now, ok: false };
  } finally {
    if (timer) clearTimeout(timer);
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
