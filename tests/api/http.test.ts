import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { hashPassword } from '@/server/auth/password.js';
import { ensureUser, publishedVersionId, testPrisma } from '../helpers/db.js';

/**
 * API-тесты против реально запущенного сервера: проверяются транспортные
 * механизмы, которые невозможно проверить на уровне сервисов —
 * cookie-сессии, CSRF, проверка Origin, коды ошибок, изоляция кандидата.
 */

const PORT = Number(process.env.API_TEST_PORT ?? 3123);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'ApiTestPassword123!';

let server: ChildProcess | null = null;

interface Session {
  cookie: string;
  csrfToken: string;
}

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/healthz`);
      if (response.ok) return;
    } catch {
      // сервер ещё не поднялся
    }
    if (Date.now() > deadline) throw new Error('Сервер API не поднялся за отведённое время');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function login(email: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Вход не выполнен: ${response.status} ${await response.text()}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).find((value) => value.startsWith('nestro_sid='));
  const data = (await response.json()) as { csrfToken: string };
  return { cookie: (cookie ?? '').split(';')[0] as string, csrfToken: data.csrfToken };
}

function authed(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookie, origin: BASE, 'x-csrf-token': session.csrfToken, ...extra };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  for (const [email, role] of [
    ['api-super@test.local', 'SuperAdmin'],
    ['api-hr@test.local', 'HR'],
    ['api-expert@test.local', 'TechnicalExpert'],
    ['api-viewer@test.local', 'Viewer'],
  ] as const) {
    await ensureUser(email, role);
    await testPrisma.user.update({ where: { email }, data: { passwordHash, isActive: true } });
  }
  await publishedVersionId('MUD_ENGINEER');

  // `next start` обслуживает и статические ресурсы (см. playwright.config.ts).
  server = spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      APP_URL: BASE,
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public',
      DISABLE_RATE_LIMIT: 'true',
      LOG_LEVEL: 'fatal',
    },
    stdio: 'ignore',
  });

  await waitForServer();
}, 180_000);

afterAll(async () => {
  server?.kill('SIGTERM');
  await testPrisma.$disconnect();
});

describe('служебные эндпоинты', () => {
  it('healthz отвечает без аутентификации', async () => {
    const response = await fetch(`${BASE}/api/healthz`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe('ok');
  });

  it('readyz проверяет БД и применённость миграций', async () => {
    const response = await fetch(`${BASE}/api/readyz`);
    const data = (await response.json()) as { status: string; checks: Record<string, boolean> };
    expect(data.checks.database).toBe(true);
    expect(data.checks.migrations).toBe(true);
    // Redis может быть недоступен: это degraded, но не ошибка прохождения теста.
    expect(['ready', 'degraded']).toContain(data.status);
  });

  it('спецификация OpenAPI отдаётся и содержит основные пути', async () => {
    const response = await fetch(`${BASE}/api/openapi.json`);
    expect(response.status).toBe(200);
    const spec = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/api/candidates/{id}/report');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(40);
  });
});

describe('аутентификация и защита транспорта', () => {
  it('без сессии административные эндпоинты возвращают 401', async () => {
    const response = await fetch(`${BASE}/api/candidates`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('неверный пароль не раскрывает существование учётной записи', async () => {
    const unknown = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: 'no-such-user@test.local', password: 'WrongPassword123!' }),
    });
    const wrong = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: 'api-hr@test.local', password: 'WrongPassword123!' }),
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const unknownBody = (await unknown.json()) as { error: { message: string } };
    const wrongBody = (await wrong.json()) as { error: { message: string } };
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
  });

  it('вход выдаёт httpOnly-cookie и CSRF-токен', async () => {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: 'api-hr@test.local', password: PASSWORD }),
    });
    expect(response.status).toBe(201);
    const cookies = response.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((value) => value.startsWith('nestro_sid='));
    expect(sessionCookie).toBeTruthy();
    // Атрибуты cookie сравниваются без учёта регистра (RFC 6265).
    expect(sessionCookie?.toLowerCase()).toContain('httponly');
    expect(sessionCookie?.toLowerCase()).toContain('samesite=lax');
    expect(sessionCookie?.toLowerCase()).toContain('path=/');
    expect(((await response.json()) as { csrfToken: string }).csrfToken).toBeTruthy();
  });

  it('небезопасный запрос без CSRF-токена отклоняется', async () => {
    const session = await login('api-hr@test.local');
    const response = await fetch(`${BASE}/api/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.cookie, origin: BASE },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/CSRF/i);
  });

  it('запрос со сторонним Origin отклоняется', async () => {
    const session = await login('api-hr@test.local');
    const response = await fetch(`${BASE}/api/invitations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: session.cookie,
        'x-csrf-token': session.csrfToken,
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/источник/i);
  });

  it('выход завершает сессию', async () => {
    const session = await login('api-hr@test.local');
    // Выход не создаёт ресурс, поэтому отвечает 200 (см. OpenAPI).
    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: authed(session) });
    expect(logout.status).toBe(200);
    const after = await fetch(`${BASE}/api/candidates`, { headers: { cookie: session.cookie } });
    expect(after.status).toBe(401);
  });

  it('ошибка валидации содержит структурированные детали', async () => {
    const session = await login('api-hr@test.local');
    const response = await fetch(`${BASE}/api/invitations`, {
      method: 'POST',
      headers: authed(session, { 'content-type': 'application/json' }),
      body: JSON.stringify({ fullName: 'к' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown[]; requestId: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('разграничение прав через API', () => {
  it('Viewer не может создать приглашение', async () => {
    const session = await login('api-viewer@test.local');
    const response = await fetch(`${BASE}/api/invitations`, {
      method: 'POST',
      headers: authed(session, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fullName: 'Иванов Иван Иванович',
        positionCode: 'MUD_ENGINEER',
        assessmentVersionId: await publishedVersionId('MUD_ENGINEER'),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('HR не может изменить веса модели оценки', async () => {
    const session = await login('api-hr@test.local');
    const versionId = await publishedVersionId('MUD_ENGINEER');
    const response = await fetch(`${BASE}/api/assessment-versions/${versionId}/weights`, {
      method: 'PATCH',
      headers: authed(session, { 'content-type': 'application/json' }),
      body: JSON.stringify({ weights: [{ competencyId: 'x', weight: 100 }] }),
    });
    expect(response.status).toBe(403);
  });

  it('HR не имеет доступа к журналу аудита', async () => {
    const session = await login('api-hr@test.local');
    const response = await fetch(`${BASE}/api/audit`, { headers: { cookie: session.cookie } });
    expect(response.status).toBe(403);
  });

  it('технический эксперт не может публиковать версию ассессмента', async () => {
    const session = await login('api-expert@test.local');
    const versionId = await publishedVersionId('MUD_ENGINEER');
    const response = await fetch(`${BASE}/api/assessment-versions/${versionId}/publish`, {
      method: 'POST',
      headers: authed(session),
    });
    expect(response.status).toBe(403);
  });

  it('Viewer не может выгрузить персональные данные кандидата', async () => {
    const session = await login('api-viewer@test.local');
    const candidate = await testPrisma.candidate.findFirst();
    if (!candidate) return;
    const response = await fetch(`${BASE}/api/candidates/${candidate.id}/export`, {
      headers: { cookie: session.cookie },
    });
    expect(response.status).toBe(403);
  });

  it('администратор имеет доступ к журналу аудита', async () => {
    const session = await login('api-super@test.local');
    const response = await fetch(`${BASE}/api/audit?pageSize=5`, { headers: { cookie: session.cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('опубликованная версия неизменяема и через API', async () => {
    const session = await login('api-super@test.local');
    const versionId = await publishedVersionId('MUD_ENGINEER');
    const competencies = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });
    const response = await fetch(`${BASE}/api/assessment-versions/${versionId}/weights`, {
      method: 'PATCH',
      headers: authed(session, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        weights: competencies.map((competency, index) => ({
          competencyId: competency.competencyId,
          weight: index === 0 ? 100 - (competencies.length - 1) : 1,
        })),
      }),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('VERSION_IMMUTABLE');
  });
});

describe('изоляция кандидата', () => {
  it('приглашение открывается без аутентификации, сессия выдаёт cookie кандидата', async () => {
    const hr = await login('api-hr@test.local');
    const created = await fetch(`${BASE}/api/invitations`, {
      method: 'POST',
      headers: authed(hr, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fullName: 'Кандидат Апи Тестович',
        positionCode: 'MUD_ENGINEER',
        assessmentVersionId: await publishedVersionId('MUD_ENGINEER'),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { invitation: { url: string } };
    const token = body.invitation.url.split('/invite/')[1] as string;

    const publicView = await fetch(`${BASE}/api/invite/${token}`);
    expect(publicView.status).toBe(200);
    const view = (await publicView.json()) as { structure: unknown[]; rules: string[] };
    expect(view.structure.length).toBeGreaterThan(0);
    expect(view.rules.length).toBeGreaterThan(0);
    // Публичная карточка не содержит данных оценки.
    expect(JSON.stringify(view)).not.toMatch(/score|band|rubric/i);

    const start = await fetch(`${BASE}/api/sessions/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ token }),
    });
    expect(start.status).toBe(201);
    const candidateCookie = (start.headers.getSetCookie?.() ?? []).find((value) =>
      value.startsWith('nestro_cand='),
    );
    expect(candidateCookie).toBeTruthy();
    expect(candidateCookie?.toLowerCase()).toContain('httponly');
    expect(candidateCookie?.toLowerCase()).toContain('samesite=lax');

    const started = (await start.json()) as { sessionId: string; csrfToken: string };
    const cookie = (candidateCookie ?? '').split(';')[0] as string;

    // Кандидат видит своё состояние.
    const own = await fetch(`${BASE}/api/sessions/${started.sessionId}`, { headers: { cookie } });
    expect(own.status).toBe(200);

    // Кандидат не имеет доступа к административному API.
    const admin = await fetch(`${BASE}/api/candidates`, { headers: { cookie } });
    expect(admin.status).toBe(401);

    // Кандидат не может обратиться к чужой сессии (§T1).
    const other = await testPrisma.testSession.findFirst({
      where: { id: { not: started.sessionId } },
      select: { id: true },
    });
    if (other) {
      const foreign = await fetch(`${BASE}/api/sessions/${other.id}`, { headers: { cookie } });
      expect(foreign.status).toBe(403);
    }

    // Кандидат не может сохранить ответ в чужую сессию.
    if (other) {
      const foreignAnswer = await fetch(`${BASE}/api/answers`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: BASE,
          'x-csrf-token': started.csrfToken,
        },
        body: JSON.stringify({
          sessionId: other.id,
          value: { kind: 'TEXT', text: 'попытка записи в чужую сессию' },
          status: 'DRAFT',
        }),
      });
      expect(foreignAnswer.status).toBe(403);
    }
  }, 60_000);
});
