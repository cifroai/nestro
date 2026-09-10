import { afterAll, describe, expect, it } from 'vitest';
import { closeRedis, isRedisAvailable } from '@/server/queue/redis.js';
import {
  enqueueFinalizeScoring,
  enqueueSessionAssessment,
  queueDepths,
} from '@/server/queue/queues.js';
import { testPrisma } from '../helpers/db.js';

/**
 * Работа при недоступной инфраструктуре очередей (§74).
 *
 * Ключевое требование: отказ Redis не должен блокировать запросы кандидата.
 * Проверяется, что проверки и постановка задач завершаются быстро и
 * возвращают управляемый отрицательный результат.
 */

const MAX_ACCEPTABLE_MS = 4000;

afterAll(async () => {
  await closeRedis();
  await testPrisma.$disconnect();
});

describe('деградация при недоступном Redis', () => {
  it('проверка доступности завершается быстро', async () => {
    const started = Date.now();
    const available = await isRedisAvailable();
    const elapsed = Date.now() - started;

    expect(typeof available).toBe('boolean');
    expect(elapsed).toBeLessThan(MAX_ACCEPTABLE_MS);
  });

  it('повторная проверка использует кеш и не обращается к сети', async () => {
    await isRedisAvailable();
    const started = Date.now();
    await isRedisAvailable();
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('постановка оценки сессии в очередь не блокирует вызывающий код', async () => {
    const started = Date.now();
    const queued = await enqueueSessionAssessment('nonexistent-session-id');
    const elapsed = Date.now() - started;

    expect(typeof queued).toBe('boolean');
    expect(elapsed).toBeLessThan(MAX_ACCEPTABLE_MS);
  });

  it('постановка пересчёта итогов не блокирует вызывающий код', async () => {
    const started = Date.now();
    await enqueueFinalizeScoring('nonexistent-session-id', 'INITIAL');
    expect(Date.now() - started).toBeLessThan(MAX_ACCEPTABLE_MS);
  });

  it('запрос глубины очередей не блокирует аналитику', async () => {
    const started = Date.now();
    const depths = await queueDepths();
    expect(Date.now() - started).toBeLessThan(MAX_ACCEPTABLE_MS);
    expect(typeof depths).toBe('object');
  });
});
