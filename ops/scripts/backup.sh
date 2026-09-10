#!/usr/bin/env bash
# Ежедневное резервное копирование (docs/DEPLOYMENT.md §8).
# Запуск из cron: 10 3 * * * /opt/nestro/ops/scripts/backup.sh
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nestro}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
COMPOSE="${COMPOSE:-docker compose}"
STAMP="$(date +%F-%H%M)"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Is)] Создание дампа базы данных"
${COMPOSE} exec -T postgres pg_dump -U "${POSTGRES_USER:-nestro}" -Fc "${POSTGRES_DB:-nestro}" \
  > "${BACKUP_DIR}/db-${STAMP}.dump"

echo "[$(date -Is)] Проверка целостности дампа"
pg_restore --list "${BACKUP_DIR}/db-${STAMP}.dump" > /dev/null

# Шифрование обязательно: дампы содержат персональные данные кандидатов.
if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  echo "[$(date -Is)] Шифрование дампа"
  age -r "${AGE_RECIPIENT}" < "${BACKUP_DIR}/db-${STAMP}.dump" > "${BACKUP_DIR}/db-${STAMP}.dump.age"
  rm -f "${BACKUP_DIR}/db-${STAMP}.dump"
else
  echo "[$(date -Is)] ВНИМАНИЕ: AGE_RECIPIENT не задан, дамп сохранён без шифрования"
fi

if [[ -n "${S3_BACKUP_TARGET:-}" ]]; then
  echo "[$(date -Is)] Копирование объектного хранилища"
  mc mirror --overwrite "${S3_BACKUP_SOURCE:-local/nestro-reports}" "${S3_BACKUP_TARGET}"
fi

echo "[$(date -Is)] Удаление дампов старше ${RETENTION_DAILY} дней"
find "${BACKUP_DIR}" -name 'db-*.dump*' -mtime "+${RETENTION_DAILY}" -delete

echo "[$(date -Is)] Резервное копирование завершено"
