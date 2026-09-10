-- Инварианты уровня БД (docs/DATABASE.md §4) и полнотекстовый поиск (§57).

-- Шкала репертуарной решётки строго 1..7 (docs/KELLY_METHOD.md §5).
ALTER TABLE "ConstructRating"
  ADD CONSTRAINT "ConstructRating_rating_range" CHECK ("rating" BETWEEN 1 AND 7);

-- Уровень rubric строго 0..4 (docs/SCORING.md §1).
ALTER TABLE "RubricLevel"
  ADD CONSTRAINT "RubricLevel_level_range" CHECK ("level" BETWEEN 0 AND 4);

-- NOT_ENOUGH_EVIDENCE не подменяется нулём (§65): score IS NULL ⟺ notEnoughEvidence.
ALTER TABLE "LLMDimensionScore"
  ADD CONSTRAINT "LLMDimensionScore_nee_consistency" CHECK (
    ("score" IS NULL AND "notEnoughEvidence" = true) OR
    ("score" IS NOT NULL AND "notEnoughEvidence" = false)
  );
ALTER TABLE "LLMDimensionScore"
  ADD CONSTRAINT "LLMDimensionScore_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 4));
ALTER TABLE "LLMDimensionScore"
  ADD CONSTRAINT "LLMDimensionScore_level_range" CHECK ("level" IS NULL OR ("level" BETWEEN 0 AND 4));

-- Red flag от LLM обязан ссылаться на конкретный ответ и цитату (§20, §66).
ALTER TABLE "RiskFlag"
  ADD CONSTRAINT "RiskFlag_llm_requires_evidence" CHECK (
    "source" <> 'LLM' OR ("answerId" IS NOT NULL AND "quote" IS NOT NULL)
  );

-- Глубина лестницы смыслов ограничена (docs/KELLY_METHOD.md §6).
ALTER TABLE "LadderStep"
  ADD CONSTRAINT "LadderStep_depth_range" CHECK ("depth" BETWEEN 1 AND 5);

-- Веса компетенций неотрицательны и не превышают 100.
ALTER TABLE "AssessmentCompetency"
  ADD CONSTRAINT "AssessmentCompetency_weight_range" CHECK ("weight" >= 0 AND "weight" <= 100);

-- Итоговые баллы в допустимых диапазонах.
ALTER TABLE "FinalScore"
  ADD CONSTRAINT "FinalScore_ranges" CHECK (
    ("score0to4" IS NULL OR ("score0to4" >= 0 AND "score0to4" <= 4)) AND
    ("score0to100" IS NULL OR ("score0to100" >= 0 AND "score0to100" <= 100)) AND
    ("confidence" >= 0 AND "confidence" <= 1)
  );

-- Ровно один действующий FinalScore на (сессия, компетенция) и на (сессия, ось),
-- и ровно один Overall. Исторические записи помечены supersededById.
CREATE UNIQUE INDEX "FinalScore_active_competency_key"
  ON "FinalScore" ("sessionId", "competencyId")
  WHERE "supersededById" IS NULL AND "competencyId" IS NOT NULL;

CREATE UNIQUE INDEX "FinalScore_active_axis_key"
  ON "FinalScore" ("sessionId", "axis")
  WHERE "supersededById" IS NULL AND "axis" IS NOT NULL AND "competencyId" IS NULL;

CREATE UNIQUE INDEX "FinalScore_active_overall_key"
  ON "FinalScore" ("sessionId")
  WHERE "supersededById" IS NULL AND "competencyId" IS NULL AND "axis" IS NULL;

-- Конструкт не может быть дубликатом самого себя, а проверка близости — парой к себе.
ALTER TABLE "CandidateConstruct"
  ADD CONSTRAINT "CandidateConstruct_no_self_duplicate" CHECK ("isDuplicateOf" IS NULL OR "isDuplicateOf" <> "id");
ALTER TABLE "ConstructSimilarityCheck"
  ADD CONSTRAINT "ConstructSimilarityCheck_distinct" CHECK ("constructAId" <> "constructBId");

-- Триада состоит из трёх различных элементов.
ALTER TABLE "KellyTriad"
  ADD CONSTRAINT "KellyTriad_distinct_elements" CHECK (
    "elementAId" <> "elementBId" AND "elementBId" <> "elementCId" AND "elementAId" <> "elementCId"
  );

-- Полнотекстовый поиск (русская конфигурация).
CREATE INDEX "Candidate_fts_idx" ON "Candidate"
  USING GIN (to_tsvector('russian', coalesce("fullName", '') || ' ' || coalesce("email", '')));

CREATE INDEX "Answer_fts_idx" ON "Answer"
  USING GIN (to_tsvector('russian', coalesce("textValue", '')));

CREATE INDEX "CandidateConstruct_fts_idx" ON "CandidateConstruct"
  USING GIN (to_tsvector('russian',
    coalesce("poleLeft", '') || ' ' || coalesce("poleRight", '') || ' ' ||
    coalesce("importanceReason", '') || ' ' || coalesce("rigManifestation", '') || ' ' ||
    coalesce("experienceExample", '')));

CREATE INDEX "HumanReview_fts_idx" ON "HumanReview"
  USING GIN (to_tsvector('russian', coalesce("reviewReason", '')));
