# syntax=docker/dockerfile:1.7

# ─── Зависимости ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Playwright скачивает браузер отдельным слоем в образе worker.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ─── Сборка ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─── Приложение (Next.js) ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nestro \
  && useradd --system --uid 1001 --gid nestro nestro

# standalone-сборка Next.js содержит только нужные зависимости.
COPY --from=builder --chown=nestro:nestro /app/.next/standalone ./
COPY --from=builder --chown=nestro:nestro /app/.next/static ./.next/static
COPY --from=builder --chown=nestro:nestro /app/public ./public
# Миграции и seed выполняются из контейнера приложения.
COPY --from=builder --chown=nestro:nestro /app/prisma ./prisma
COPY --from=builder --chown=nestro:nestro /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nestro:nestro /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nestro:nestro /app/node_modules/prisma ./node_modules/prisma

USER nestro
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "server.js"]

# ─── Worker (очереди, LLM-оценка, PDF) ───────────────────────────────────────
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nestro \
  && useradd --system --uid 1001 --gid nestro nestro

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY . .

# Chromium для печати PDF-отчётов (docs/DEPLOYMENT.md).
RUN npx playwright install --with-deps chromium \
  && chown -R nestro:nestro /opt/pw-browsers

USER nestro
CMD ["npx", "tsx", "worker/index.ts"]
