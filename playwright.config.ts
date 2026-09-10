import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * End-to-end проверки ключевых сценариев в браузере (§60).
 * Сервер поднимается из production-сборки, база — тестовая.
 */

const PORT = Number(process.env.E2E_PORT ?? 3131);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public';

// В окружении разработки Chromium может лежать в общем каталоге сборок.
const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].filter((path): path is string => Boolean(path));
const executablePath = CHROMIUM_CANDIDATES.find((path) => existsSync(path));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath, args: ['--no-sandbox'] } } : {}),
  },
  webServer: {
    command: 'node .next/standalone/server.js',
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      APP_URL: BASE_URL,
      DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret-000000000000000000000000',
      INVITATION_SECRET: 'e2e-invitation-secret-00000000000000000000',
      DISABLE_RATE_LIMIT: 'true',
      LOG_LEVEL: 'fatal',
    },
  },
});
