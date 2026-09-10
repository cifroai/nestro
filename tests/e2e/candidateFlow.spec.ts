import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/server/auth/password.js';

/**
 * End-to-end: HR создаёт приглашение, кандидат открывает ссылку, проходит
 * первый шаг, закрывает страницу и продолжает с того же места (§53).
 */

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public',
    },
  },
});

const HR_EMAIL = 'e2e-hr@test.local';
const PASSWORD = 'E2ePassword12345!';

test.beforeAll(async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'HR' } });
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: HR_EMAIL },
    update: { passwordHash, isActive: true },
    create: { email: HR_EMAIL, fullName: 'HR для e2e', passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  const version = await prisma.assessmentVersion.findFirstOrThrow({
    where: { assessment: { position: { code: 'MUD_ENGINEER' } }, version: 1 },
  });
  if (version.status !== 'PUBLISHED') {
    await prisma.assessmentVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('HR входит в систему и видит дашборд', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Адрес электронной почты').fill(HR_EMAIL);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Приглашено')).toBeVisible();
  await expect(page.getByText('Требует экспертной проверки')).toBeVisible();
  // Методическая оговорка присутствует на дашборде.
  await expect(page.getByText(/Кадровое решение принимает человек/)).toBeVisible();
});

test('кандидат открывает приглашение, проходит триаду и продолжает после перезагрузки', async ({
  page,
  request,
}) => {
  // Приглашение создаётся через API от имени HR.
  const loginResponse = await request.post('/api/auth/login', {
    data: { email: HR_EMAIL, password: PASSWORD },
    headers: { origin: new URL(page.url() || 'http://127.0.0.1').origin },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const { csrfToken } = (await loginResponse.json()) as { csrfToken: string };

  const version = await prisma.assessmentVersion.findFirstOrThrow({
    where: { assessment: { position: { code: 'MUD_ENGINEER' } }, version: 1 },
  });

  const invitationResponse = await request.post('/api/invitations', {
    data: {
      fullName: 'Кандидат Браузерный Тестович',
      positionCode: 'MUD_ENGINEER',
      assessmentVersionId: version.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    headers: { 'x-csrf-token': csrfToken },
  });
  expect(invitationResponse.status()).toBe(201);
  const created = (await invitationResponse.json()) as { invitation: { url: string } };
  const token = created.invitation.url.split('/invite/')[1] as string;

  // Кандидат открывает страницу приглашения.
  await page.context().clearCookies();
  await page.goto(`/invite/${token}`);

  await expect(page.getByRole('heading', { name: 'Инженер по буровым растворам' })).toBeVisible();
  await expect(page.getByText('Структура тестирования')).toBeVisible();
  await expect(page.getByText(/Доступ к веб-камере и микрофону не запрашивается/)).toBeVisible();

  // Согласие обязательно: кнопка недоступна до отметки.
  const startButton = page.getByRole('button', { name: 'Начать тестирование' });
  await expect(startButton).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // Первый шаг — триада с восемью полями.
  await expect(page.getByRole('heading', { name: 'Профессиональные критерии оценки' })).toBeVisible();
  await expect(
    page.getByText('Какие два специалиста наиболее похожи с точки зрения профессиональной эффективности?'),
  ).toBeVisible();
  // Анти-прайминг: готовых примеров конструктов нет.
  await expect(page.getByText(/Примеры готовых формулировок не приводятся намеренно/)).toBeVisible();

  const sessionUrl = page.url();
  expect(sessionUrl).toMatch(/\/t\//);

  // Заполнение полей триады.
  const long = (text: string, min: number): string => {
    let result = text;
    while (result.length < min) result += ` ${text}`;
    return result;
  };

  await page.getByRole('button', { name: /Один из лучших инженеров/ }).click();
  await page.getByRole('button', { name: /способный заранее обнаружить/ }).click();

  await page
    .getByLabel(/Чем именно эти два специалиста похожи/)
    .fill(long('Оба замечают развитие ситуации заранее и действуют до осложнения', 60));
  await page
    .getByLabel('Чем третий отличается')
    .fill(long('Третий реагирует только после возникновения осложнения', 60));
  await page.getByLabel(/Первый полюс критерия/).fill('работает на предупреждение');
  await page.getByLabel(/Противоположный полюс/).fill('реагирует после события');
  await page
    .getByLabel('Почему этот критерий важен')
    .fill(long('Предупреждение дешевле ликвидации и снижает риск аварии', 60));
  await page
    .getByLabel('Как этот критерий проявляется непосредственно на буровой')
    .fill(long('Заранее корректирует параметры раствора при росте СНС', 60));
  await page
    .getByLabel('Приведите пример из собственного опыта')
    .fill(long('На кусте 12 при росте СНС мы увеличили расход и включили ротацию, шлам вышел за два цикла', 120));

  // Прогресс сохраняется автоматически.
  await expect(page.getByText(/Черновик сохранён на сервере|Сохранение…/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Далее' }).click();

  // Переход к следующему шагу.
  await expect(page.getByText(/Триада 2 из|Уточнение критериев/)).toBeVisible({ timeout: 20_000 });

  // Перезагрузка возвращает кандидата на актуальный шаг, а не в начало.
  await page.reload();
  await expect(page.getByText(/Триада 2 из|Уточнение критериев/)).toBeVisible({ timeout: 20_000 });

  // Конструкт сохранён на сервере.
  const sessionId = sessionUrl.split('/t/')[1] as string;
  const constructs = await prisma.candidateConstruct.count({ where: { sessionId } });
  expect(constructs).toBeGreaterThanOrEqual(1);
});
