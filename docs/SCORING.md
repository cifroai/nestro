# SCORING — модель количественной оценки

Модуль: `src/server/scoring/**`. Чистые функции, без I/O, без обращения к БД и
LLM. Все формулы ниже реализованы буквально и покрыты unit-тестами
(`tests/scoring/**`). Детерминизм: для фиксированного набора входов результат
побитово идентичен (§60).

---

## 1. Единая шкала уровней (§12)

| Уровень | Название | Формальный критерий |
|---|---|---|
| 0 | отсутствует | нет рабочей гипотезы либо ответ противоречит базовой профессиональной логике |
| 1 | декларативный | верный принцип без механизма применения |
| 2 | операционный | конкретные действия и показатели |
| 3 | системный | данные → причина → риск → решение → контроль результата |
| 4 | экспертный | + альтернативные гипотезы, неопределённость, межсервисные эффекты, вторичные последствия, экономика, критерии остановки, границы полномочий, извлечённый урок |

Отдельное значение **`NOT_ENOUGH_EVIDENCE`** (§65) — это **не 0**. Оно
исключается из усреднения и снижает `confidence`, но не снижает `score`.

---

## 2. Уровни агрегации

```
LLMDimensionScore (evaluator × ответ × компетенция)
        │  combineEvaluators()
        ▼
AnswerCompetencyScore (ответ × компетенция)
        │  applyHumanReview()
        ▼
EffectiveAnswerScore (ответ × компетенция)
        │  calculateCompetencyScore()
        ▼
CompetencyScore (сессия × компетенция)      →  Level, Confidence, Band
        │  calculateAxisScores()  /  calculateAssessmentScore()
        ▼
AxisScore (8 осей §17)  и  Overall Professional Score 0–100
```

## 3. Шаг 1 — объединение двух evaluators (§16)

Для ответа `a` и компетенции `c` есть до двух суждений `s_A`, `s_B` ∈ [0,4] ∪ {NEE}.

```
if s_A = NEE and s_B = NEE      -> NEE, agreement = null
if ровно одно NEE               -> score = имеющийся, agreement = 0.5,
                                   reviewRequired = true   // асимметрия доказательств
else
    delta   = |s_A − s_B|
    score   = (s_A + s_B) / 2
    agreement = 1 − delta / 4
    reviewRequired = delta >= disagreementThreshold      // по умолчанию 1.0
```

`disagreementThreshold` — поле `AssessmentVersion.disagreementThreshold`,
редактируется администратором. Если Evaluator B отключён в версии, `agreement`
берётся равным `null` и в confidence используется нейтральное значение 0.6.

## 4. Шаг 2 — human review (§29)

```
if exists HumanReview(answer, competency):
    effective = humanScore            // human_score всегда побеждает
    humanReviewed = true
    if markedUninformative: effective = NEE
else:
    effective = combined
```

Хранятся все три величины: `model_score` (combined), `human_score`,
`final_score` (= effective), плюс `review_reason`, `reviewer_id`, `timestamp`.

## 5. Шаг 3 — балл компетенции

Пусть `A_c` — множество ответов, где компетенция `c` измерялась и есть
`effective ≠ NEE`. `w_i` — `QuestionCompetency.weightWithinCompetency` (по
умолчанию 1.0), `q_i` — качество доказательства ответа `i`:

```
q_i = clamp( 0.5 + 0.5 · evidenceQuality_i , 0.5 , 1.0 )
evidenceQuality_i = min(1, supportingEvidenceCount_i / 2)
```

Балл компетенции:

```
score0to4(c) = Σ_{i∈A_c} (w_i · q_i · effective_i) / Σ_{i∈A_c} (w_i · q_i)
score0to100(c) = score0to4(c) / 4 · 100
level(c)       = floor(score0to4(c) + 0.5)      // округление к ближайшему уровню
```

Если `A_c = ∅` → компетенция получает `notEnoughEvidence = true`,
`score = null`. Такая компетенция **не обнуляется** и исключается из
взвешивания overall с перенормировкой (см. §7).

## 6. Шаг 4 — confidence (§64)

Confidence измеряет **надёжность вывода**, а не квалификацию кандидата.

```
S_evidence    = min(1, Σ_{i∈A_c} supportingEvidenceCount_i / requiredEvidence(c))
S_agreement   = mean(agreement_i)                       // null → 0.6
S_consistency = 1 − min(1, stdev(effective_i) / 1.5)    // |A_c| < 2 → 0.6
S_coverage    = min(1, |distinctQuestions(A_c)| / minQuestions(c))
S_human       = 1 если есть подтверждённый human review, иначе 0

confidence(c) = clamp01( 0.35·S_evidence + 0.25·S_agreement
                       + 0.20·S_consistency + 0.10·S_coverage + 0.10·S_human )
```

`requiredEvidence(c)` = `AssessmentCompetency.minEvidenceCount` (по умолчанию 4),
`minQuestions(c)` = 3 по умолчанию, настраивается в ScoringModel.

Интерпретация в UI (текстом, не цветом-приговором):
`≥0.75 — высокая`, `0.5–0.74 — средняя`, `<0.5 — низкая, требуется проверка`.
Низкий confidence **никогда** не трактуется как низкая квалификация — это
явно указано в отчёте.

## 7. Шаг 5 — Overall Professional Score

Веса `W_c` берутся из `AssessmentCompetency.weight` версии ассессмента
(§13/§14, редактируются администратором). Компетенции без данных исключаются,
веса перенормируются:

```
C* = { c : notEnoughEvidence(c) = false }
W*_c = W_c / Σ_{k∈C*} W_k

Overall = Σ_{c∈C*} W*_c · score0to100(c)

coverage = Σ_{c∈C*} W_c / Σ_{all c} W_c
```

Если `coverage < 0.6` → итог помечается **«Недостаточно данных»** (§18) и
Overall выводится как справочная величина с явной пометкой, band не
присваивается.

```
OverallConfidence = Σ_{c∈C*} W*_c · confidence(c) · coverage
```

### Начальные веса (редактируемые)

**Инженер по буровым растворам (§13)**

| Компетенция | Код | Вес |
|---|---|---|
| Предупреждение осложнений | `PREVENTION` | 15% |
| Причинно-следственный анализ | `CAUSAL` | 15% |
| Управление системой РВО | `MUD_SYSTEM` | 15% |
| Очистка ствола / гидравлика | `HOLE_CLEANING` | 10% |
| Система очистки | `SOLIDS_CONTROL` | 8% |
| Работа по данным и тенденциям | `DATA_TRENDS` | 10% |
| Принятие решений | `DECISION` | 8% |
| Управление риском / эскалация | `RISK_ESCALATION` | 7% |
| Коммуникация | `COMMUNICATION` | 5% |
| Документирование / передача смены | `DOCUMENTATION` | 3% |
| Экономика | `ECONOMICS` | 2% |
| Извлечённые уроки | `LESSONS` | 2% |

**Инженер интегрированного сервиса (§14)**

| Компетенция | Код | Вес |
|---|---|---|
| Системное мышление | `SYSTEMS_THINKING` | 18% |
| Межсервисные зависимости | `CROSS_SERVICE` | 15% |
| Прогнозирование и предотвращение рисков | `RISK_PREVENTION` | 15% |
| Причинно-следственный анализ | `CAUSAL` | 12% |
| Работа по данным и тенденциям | `DATA_TRENDS` | 10% |
| Принятие решений | `DECISION` | 8% |
| Коммерческая скорость / НПВ | `NPT_SPEED` | 7% |
| Управление подрядчиками | `CONTRACTOR_MGMT` | 5% |
| Коммуникация | `COMMUNICATION` | 5% |
| Эскалация | `ESCALATION` | 3% |
| Документирование | `DOCUMENTATION` | 1% |
| Извлечённые уроки | `LESSONS` | 1% |

## 8. Восемь агрегированных осей (§17)

`Competency.axis` относит компетенцию к одной из осей; балл оси — взвешенное
среднее её компетенций теми же весами `W_c`, перенормированными внутри оси.

| Ось | Компетенции (буровые растворы / ИС) |
|---|---|
| `TECHNICAL_REASONING` | `MUD_SYSTEM`, `HOLE_CLEANING`, `SOLIDS_CONTROL` / `NPT_SPEED` |
| `SYSTEM_THINKING` | `SOLIDS_CONTROL`, `HOLE_CLEANING` / `SYSTEMS_THINKING`, `CROSS_SERVICE` |
| `RISK_MANAGEMENT` | `RISK_ESCALATION` / `RISK_PREVENTION`, `ESCALATION` |
| `PREVENTIVE_THINKING` | `PREVENTION` / `RISK_PREVENTION` |
| `DECISION_MAKING` | `DECISION`, `DATA_TRENDS` |
| `OPERATIONAL_MATURITY` | `DOCUMENTATION`, `ECONOMICS`, `CONTRACTOR_MGMT` |
| `COMMUNICATION` | `COMMUNICATION` |
| `SELF_AWARENESS` | `LESSONS` + Kelly gap-метрики (см. §11) |

## 9. Квалификационные категории (§18)

Пороги — поле `AssessmentVersion.bandThresholds` (JSONB), редактируются.

| Диапазон | Код | Формулировка (нейтральная) |
|---|---|---|
| 85–100 | `EXPERT` | выраженный экспертный уровень |
| 70–84 | `HIGH` | высокий профессиональный уровень |
| 55–69 | `SUFFICIENT` | достаточный / требует проверки отдельных компетенций |
| 40–54 | `GAPS` | имеются существенные квалификационные пробелы |
| 0–39 | `NOT_CONFIRMED` | текущие ответы не подтверждают требуемый уровень |
| — | `INSUFFICIENT_DATA` | недостаточно данных (coverage < 0.6) |

Слова «принять», «отказать», «пригоден», «непригоден» отсутствуют в кодовой
базе — проверяется тестом `tests/unit/forbiddenVocabulary.test.ts`.

## 10. Hard-gates (§19)

`AssessmentCompetency.isHardGate = true`. Условие срабатывания:

```
score0to4(c) < gateThreshold (по умолчанию 2.0)   ИЛИ   notEnoughEvidence(c)
```

Результат — **не отклонение**, а запись:

```
{ competency, status: 'REQUIRES_ADDITIONAL_CHECK',
  message: 'Критическая компетенция требует дополнительной проверки' }
```

и `reviewRequired = true` для сессии.

Критические компетенции по умолчанию:
* буровые растворы: `RISK_ESCALATION`, `CAUSAL`, `PREVENTION`, `MUD_SYSTEM`,
  плюс правило безопасности технических решений (`SAFETY_RULE`, см. §12 ниже);
* ИС: `SYSTEMS_THINKING`, `RISK_PREVENTION`, `CROSS_SERVICE`, `CAUSAL`, `ESCALATION`.

## 11. Kelly-метрики в скоринге (§21)

Метрики решётки **не входят** в Overall напрямую. Они питают ось
`SELF_AWARENESS` и раздел отчёта «Расхождение Я/Идеал»:

```
selfIdealGap   = manhattan(E10, E9) / (numConstructs · 6)     ∈ [0,1]
selfBestGap    = manhattan(E10, E1) / (numConstructs · 6)
selfWeakGap    = manhattan(E10, E8) / (numConstructs · 6)
```

Вклад в `SELF_AWARENESS` (только при наличии заполненной решётки):

```
reflectionSignal = 1 − |selfIdealGap − 0.35| / 0.65
```

Обоснование: и нулевой разрыв (некритичная самооценка), и максимальный
(отсутствие профессиональной идентификации с ролью) одинаково снижают сигнал
рефлексии; целевая зона — умеренный осознаваемый разрыв. Величина трактуется
как **наблюдение**, а не диагноз, и всегда сопровождается табличным выводом
исходных расстояний. Вес сигнала в оси — 0.25, остальные 0.75 — `LESSONS`.

## 12. Правила-детекторы (не-LLM) — `detectRuleFlags()`

Часть red flags (§20) определяется детерминированными правилами по структуре
ответа, что даёт независимый от LLM источник:

| Код | Правило |
|---|---|
| `NO_EXPERIENCE_EXAMPLE` | поле «пример из опыта» пустое или < 80 символов в ≥50% триад |
| `NO_MISSING_DATA_REQUEST` | ни в одном многоэтапном кейсе не заполнено «какой информации не хватает» |
| `NO_SUCCESS_CRITERION` | ни в одном кейсе не заполнен «критерий подтверждения правильности» |
| `NO_ESCALATION_MENTION` | ни в одном кейсе не заполнено «когда требуется эскалация» |
| `GRID_NO_DISCRIMINATION` | ≥80% клеток решётки имеют одинаковое значение |
| `EXTREME_POLARIZATION` | ≥85% оценок ∈ {1,7} |
| `GENERIC_ANSWERS` | средняя длина открытых ответов < 120 символов при ≥10 вопросах |

LLM-детектируемые флаги (`SAFETY_RULE`, `IGNORES_RISK`, `CAUSE_SYMPTOM_CONFUSION`,
`ACTS_BEYOND_AUTHORITY`, `BLAME_SEEKING`, `NO_RESULT_CONTROL`, `SILO_FOCUS`,
`DECIDES_WITHOUT_DATA`, `DENIES_UNCERTAINTY`, `AVOIDS_DECISIONS`,
`PROCEDURE_VIOLATION_UNASSESSED`) обязаны содержать `answerId` и `quote` —
иначе флаг отбрасывается валидатором (§66: рекомендация без evidence запрещена).

## 13. Противоречия (§22) — `detectCrossAnswerContradictions()`

Алгоритм:
1. Из `LadderStep` и `CandidateConstruct` строится набор деклараций с кодами
   компетенций (маппинг конструкт → компетенция даёт LLM-шаг `CONSTRUCT_MAP`,
   но с обязательным `constructId` и цитатой).
2. Для декларации с компетенцией `c` и заявленной высокой важностью
   (конструкт вошёл в топ-5 по значимости) берётся `score0to4(c)`.
3. Если `declaredImportanceRank ≤ 5` и `score0to4(c) ≤ 2.0` →
   `Contradiction{ strength = (2.0 − score)/2.0 }`.
4. Формулировка строго: **«Потенциальное расхождение между декларируемым
   конструктом и решениями в кейсах»**. Слова «лжёт», «неискренен» запрещены.

## 14. Публичный интерфейс модуля (§73)

```ts
combineEvaluators(a: Judgement, b: Judgement | null, threshold: number): Combined
applyHumanReview(combined: Combined, review: HumanReviewInput | null): Effective
calculateCompetencyScore(inputs: AnswerScoreInput[], cfg: CompetencyConfig): CompetencyScore
calculateConfidence(inputs: AnswerScoreInput[], cfg: CompetencyConfig): number
calculateAxisScores(scores: CompetencyScore[], map: AxisMap): AxisScore[]
calculateAssessmentScore(scores: CompetencyScore[], weights: WeightMap): AssessmentScore
resolveBand(overall: number, coverage: number, thresholds: BandThresholds): Band
detectCriticalGaps(scores: CompetencyScore[], cfg: HardGateConfig): CriticalGap[]
detectRuleFlags(session: SessionSnapshot): RiskFlagDraft[]
detectCrossAnswerContradictions(decls: Declaration[], scores: CompetencyScore[]): Contradiction[]
computeGridMetrics(grid: GridMatrix): GridMetrics          // src/server/kelly
```

Все функции принимают простые структуры (без Prisma-типов) и возвращают
структуры без побочных эффектов. Округление — половина вверх до 3 знаков,
единая утилита `round3()`, чтобы исключить платформенные расхождения.

## 15. Воспроизводимость (§32)

`FinalScore` хранит `scoringModelId`; `LLMAssessment` — `promptTemplateId`,
`llmProvider`, `llmModel`, `llmModelVersion`. Пересчёт исторических результатов
выполняется **только явной командой** и создаёт новую запись `FinalScore` со
ссылкой `supersededById` на предыдущую; старая остаётся доступной. Молчаливый
пересчёт запрещён и покрыт тестом.
