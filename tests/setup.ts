// NODE_ENV задаётся vitest; остальные переменные подставляем для тестов.
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/1';
process.env.SESSION_SECRET ??= 'test-session-secret-000000000000000000000000';
process.env.INVITATION_SECRET ??= 'test-invitation-secret-00000000000000000000';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.LLM_PROVIDER ??= 'none';
process.env.LOG_LEVEL ??= 'fatal';
process.env.DISABLE_RATE_LIMIT ??= 'true';
