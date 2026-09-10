-- Активность записи итогового балла определяется отдельным полем.
--
-- Причина: при пересчёте новая запись создаётся до того, как предыдущая
-- получит ссылку supersededById (ссылка указывает на ещё не созданную строку).
-- Если активность определять по supersededById, внутри транзакции временно
-- существуют две активные записи и срабатывает частичный уникальный индекс.
-- Поле supersededAt снимается со старой записи первым шагом, что сохраняет
-- инвариант «одна действующая запись» и историю расчётов (§32).

ALTER TABLE "FinalScore" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- Существующие вытесненные записи помечаются по имеющейся ссылке.
UPDATE "FinalScore" SET "supersededAt" = "computedAt" WHERE "supersededById" IS NOT NULL;

DROP INDEX IF EXISTS "FinalScore_active_competency_key";
DROP INDEX IF EXISTS "FinalScore_active_axis_key";
DROP INDEX IF EXISTS "FinalScore_active_overall_key";

CREATE UNIQUE INDEX "FinalScore_active_competency_key"
  ON "FinalScore" ("sessionId", "competencyId")
  WHERE "supersededAt" IS NULL AND "competencyId" IS NOT NULL;

CREATE UNIQUE INDEX "FinalScore_active_axis_key"
  ON "FinalScore" ("sessionId", "axis")
  WHERE "supersededAt" IS NULL AND "axis" IS NOT NULL AND "competencyId" IS NULL;

CREATE UNIQUE INDEX "FinalScore_active_overall_key"
  ON "FinalScore" ("sessionId")
  WHERE "supersededAt" IS NULL AND "competencyId" IS NULL AND "axis" IS NULL;

CREATE INDEX "FinalScore_active_idx" ON "FinalScore" ("sessionId") WHERE "supersededAt" IS NULL;
