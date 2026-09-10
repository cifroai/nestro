# DEPLOYMENT — развёртывание на сервере Заказчика

## 1. Топология

```
                    ┌──────────── Linux-сервер Заказчика ────────────┐
  Интернет/LAN  →   │ nginx (TLS 443)                                │
                    │   ├── /            → app:3000   (Next.js)      │
                    │   └── /api         → app:3000                  │
                    │ worker  (BullMQ consumer, chromium для PDF)    │
                    │ postgres:16   redis:7   minio (S3-compatible)  │
                    └────────────────────────────────────────────────┘
```

Все контейнеры — в приватной docker-сети; наружу открыт только nginx.
Postgres/Redis/MinIO не публикуют порты на хост в production-профиле.

## 2. Требования к серверу

| Ресурс | Минимум | Рекомендуется |
|---|---|---|
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 ГБ | 16 ГБ (argon2id + chromium + postgres) |
| Диск | 100 ГБ SSD | 250 ГБ SSD, отдельный том для БД и бэкапов |
| ОС | Ubuntu 22.04 / RHEL 9, Docker 24+, Compose v2 | — |

## 3. Первый запуск

```bash
git clone <repo> /opt/nestro && cd /opt/nestro
cp .env.example .env
# заполнить: POSTGRES_PASSWORD, SESSION_SECRET, INVITATION_SECRET,
#            REDIS_PASSWORD, MINIO_ROOT_PASSWORD, LLM_API_KEY (опционально)
openssl rand -base64 48   # для каждого секрета

docker compose --profile prod up -d --build
docker compose exec app npm run db:migrate:deploy
docker compose exec app npm run db:seed        # должности, компетенции, кейсы
docker compose exec app npm run admin:create -- --email admin@example.com
```

Проверка: `curl -fsS https://<host>/api/readyz` → `{"status":"ready"}`.

## 4. Переменные окружения

| Переменная | Обяз. | Описание |
|---|---|---|
| `DATABASE_URL` | да | `postgresql://user:pass@postgres:5432/nestro?schema=public` |
| `REDIS_URL` | да | `redis://:pass@redis:6379/0` |
| `SESSION_SECRET` | да | ≥32 байта, подпись cookie |
| `INVITATION_SECRET` | да | HMAC-соль для токенов приглашений |
| `APP_URL` | да | публичный URL. **Схема определяет признак `Secure` для cookie сессии**: в production обязателен `https`, иначе браузер отбросит cookie и вход будет невозможен |
| `LLM_PROVIDER` | нет | `anthropic` \| `openai` \| `openrouter` \| `local` \| `none` |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_PRIMARY`, `LLM_MODEL_SECONDARY` | нет | конфиг провайдера; при `none` система работает в режиме `ASSESSMENT_PENDING` |
| `LLM_MAX_CONCURRENCY`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` | нет | защита от DoS/расходов |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | нет | при отсутствии — локальный том `./storage` |
| `SMTP_*` | нет | отправка приглашений; при отсутствии ссылка копируется вручную |
| `RETENTION_MONTHS` | нет | по умолчанию 24 |
| `LOG_LEVEL` | нет | `info` |

Секреты только через env/docker secrets, никогда в git (§9 SECURITY).

## 5. Права БД (принцип наименьших прав)

```sql
-- миграции выполняет отдельная роль-владелец
CREATE ROLE nestro_owner LOGIN PASSWORD '…';
-- приложение работает под ограниченной ролью
CREATE ROLE nestro_app LOGIN PASSWORD '…';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nestro_app;
-- audit log — append-only даже для приложения
REVOKE UPDATE, DELETE ON "AuditLog" FROM nestro_app;
-- published-версии защищены сервисным слоем + этим запретом:
REVOKE DELETE ON "AssessmentVersion" FROM nestro_app;
```

## 6. Миграции

* Разработка: `npm run db:migrate -- --name <имя>` (Prisma Migrate).
* Production: `npm run db:migrate:deploy` — только применение готовых миграций.
* Правило: **миграции только вперёд**; для изменения смысла существующего
  поля создаётся новое поле + backfill-скрипт, старое помечается deprecated.
* `/api/readyz` возвращает `503`, если есть непримененные миграции.

## 7. Обновление версии

```bash
cd /opt/nestro && git fetch && git checkout <tag>
docker compose --profile prod build
docker compose --profile prod up -d --no-deps app worker
docker compose exec app npm run db:migrate:deploy
```

Незавершённые кандидатские сессии не затрагиваются: они привязаны к
`AssessmentVersion`, а не к версии кода. Job-и в Redis переживают
перезапуск worker (persistent Redis + AOF).

## 8. Backup

### 8.1. PostgreSQL

```bash
# ежедневно, cron 03:10
docker compose exec -T postgres pg_dump -U nestro -Fc nestro \
  > /var/backups/nestro/db-$(date +%F).dump
# шифрование
age -r <recipient> < db-$(date +%F).dump > db-$(date +%F).dump.age && rm db-*.dump
```

* Retention: 7 ежедневных, 4 недельных, 12 месячных.
* PITR: `archive_mode = on`, `archive_command` в отдельный том/хранилище;
  позволяет восстановление на момент времени.
* Проверка целостности: `pg_restore --list` после каждого дампа.

### 8.2. Object storage

`mc mirror --overwrite local/nestro-reports /var/backups/nestro/objects/`
ежедневно; отчёты воспроизводимы из БД, поэтому объектное хранилище —
второй приоритет.

### 8.3. Restore

```bash
docker compose stop app worker
docker compose exec -T postgres createdb -U nestro nestro_restore
age -d -i key.txt db-2026-09-01.dump.age | \
  docker compose exec -T postgres pg_restore -U nestro -d nestro_restore --clean --if-exists
# верификация: контрольные счётчики
docker compose exec -T postgres psql -U nestro -d nestro_restore -c \
  'select count(*) from "TestSession"; select count(*) from "FinalScore"; select count(*) from "AuditLog";'
# переключение
docker compose exec -T postgres psql -U nestro -c \
  'ALTER DATABASE nestro RENAME TO nestro_old; ALTER DATABASE nestro_restore RENAME TO nestro;'
docker compose start app worker
```

### 8.4. Проверка целостности после восстановления

```bash
docker compose exec app npx tsx scripts/verifyIntegrity.ts
```

Скрипт проверяет: сумму весов опубликованных версий, наличие снапшота
конфигурации, наличие ровно одного действующего итогового балла у оценённых
сессий, обязательность ссылки на ответ и цитату у маркеров риска от модели,
согласованность значения «недостаточно данных», наличие причины у экспертных
оценок; выводит контрольные счётчики для сверки с исходной базой.

Дополнительно доступна методическая проверка текстов:

```bash
docker compose exec app npx tsx scripts/vocabularyScan.ts
```

Она проверяет отсутствие кадровой и диагностической лексики в интерфейсе и
seed-данных, а также отсутствие защищаемых характеристик среди полей модели
данных.

### 8.5. Disaster recovery

| Показатель | Значение |
|---|---|
| RPO | 15 минут (WAL-архивация) / 24 часа (только дампы) |
| RTO | 1 час при наличии подготовленного сервера |
| Порядок | 1) поднять postgres из дампа+WAL, 2) redis с нуля (очереди
восстанавливаются: незавершённые LLM-оценки перезапускаются идемпотентно по
`assessmentStatus = PENDING`), 3) app+worker, 4) проверка `/api/readyz`,
5) прогон `npm run verify:integrity` (сверка сумм весов, наличия FinalScore у
завершённых сессий) |
| Учения | ежемесячное тестовое восстановление в staging, результат фиксируется |
| Скрипты | `ops/scripts/backup.sh` (с шифрованием и проверкой дампа), `ops/scripts/restore.sh` (восстановление в отдельную базу без перезаписи действующей) |

Ключи шифрования бэкапов хранятся **отдельно** от самих бэкапов.

## 9. Логи и мониторинг

* stdout контейнеров → journald/loki. Формат — JSON (pino).
* Audit log — в БД, экспортируется отдельно (`GET /api/audit` + CSV).
* Метрики для внешнего мониторинга: `/api/healthz`, `/api/readyz`, длина
  очередей (`GET /api/analytics` содержит `queueDepth` для админа).
* Алерты: `readyz != ready` 3 раза подряд; глубина очереди LLM > 200;
  доля `INVALID_JSON` > 5% за час; ошибок 5xx > 1%.

## 10. Профили compose

| Профиль | Состав | Назначение |
|---|---|---|
| `dev` | postgres, redis (порты на хост), app в watch-режиме | локальная разработка |
| `prod` | nginx, app, worker, postgres, redis, minio | production |
| `test` | postgres-test, redis-test | CI, интеграционные тесты |
