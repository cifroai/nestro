#!/usr/bin/env bash
# Восстановление из резервной копии (docs/DEPLOYMENT.md §8.3).
#
# Скрипт НЕ перезаписывает действующую базу: он восстанавливает дамп в
# отдельную базу nestro_restore. Переключение выполняется администратором
# вручную после проверки контрольных счётчиков.
set -Eeuo pipefail

DUMP_FILE="${1:?Укажите путь к файлу дампа}"
COMPOSE="${COMPOSE:-docker compose}"
TARGET_DB="${TARGET_DB:-nestro_restore}"
DB_USER="${POSTGRES_USER:-nestro}"

echo "[$(date -Is)] Остановка приложения и worker"
${COMPOSE} stop app worker

echo "[$(date -Is)] Создание базы ${TARGET_DB}"
${COMPOSE} exec -T postgres createdb -U "${DB_USER}" "${TARGET_DB}" || true

echo "[$(date -Is)] Восстановление дампа"
if [[ "${DUMP_FILE}" == *.age ]]; then
  age -d -i "${AGE_IDENTITY:?Укажите AGE_IDENTITY}" < "${DUMP_FILE}" \
    | ${COMPOSE} exec -T postgres pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --clean --if-exists
else
  ${COMPOSE} exec -T postgres pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --clean --if-exists < "${DUMP_FILE}"
fi

echo "[$(date -Is)] Контрольные счётчики восстановленной базы"
${COMPOSE} exec -T postgres psql -U "${DB_USER}" -d "${TARGET_DB}" -c '
  SELECT
    (SELECT count(*) FROM "TestSession")  AS sessions,
    (SELECT count(*) FROM "Answer")       AS answers,
    (SELECT count(*) FROM "FinalScore")   AS final_scores,
    (SELECT count(*) FROM "AuditLog")     AS audit_entries;
'

cat <<'NOTE'

Проверьте счётчики. Для переключения на восстановленную базу выполните вручную:

  docker compose exec -T postgres psql -U nestro -c \
    'ALTER DATABASE nestro RENAME TO nestro_old; ALTER DATABASE nestro_restore RENAME TO nestro;'
  docker compose start app worker
  curl -fsS https://<host>/api/readyz

NOTE
