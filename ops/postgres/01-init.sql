-- Инициализация БД: расширения и роль приложения с ограниченными правами
-- (docs/DEPLOYMENT.md §5).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Роль приложения создаётся отдельно от владельца схемы; пароль задаётся
-- администратором при первом развёртывании.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestro_app') THEN
    CREATE ROLE nestro_app LOGIN PASSWORD 'CHANGE_ME_AFTER_DEPLOY';
  END IF;
END
$$;
