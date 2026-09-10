# API

REST over HTTPS, JSON. Базовый префикс `/api`. Машиночитаемая спецификация —
`GET /api/openapi.json` (генерируется из Zod-схем, единый источник истины),
человекочитаемая — `/api/docs`.

## 1. Соглашения

* Аутентификация: cookie-сессия. Staff — `nestro_sid`, кандидат — `nestro_cand`.
* Небезопасные методы требуют CSRF-заголовок `x-csrf-token` (double submit) и
  совпадения `Origin`.
* Идемпотентность: `POST /api/answers` идемпотентен по
  (`sessionId`, `questionVersionId`, `clientRevision`).
* Ошибки — единый формат:

```json
{ "error": { "code": "FORBIDDEN", "message": "Недостаточно прав",
             "details": [], "requestId": "01J…" } }
```

Коды: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `GONE` (410, истёкшее приглашение),
`RATE_LIMITED` (429), `INTERNAL` (500), `LLM_UNAVAILABLE` (503, только для
диагностических эндпоинтов — прохождение теста не зависит от LLM).

* Пагинация: `?page=1&pageSize=50` → `{ items, total, page, pageSize }`.
* Сортировка: `?sort=field:asc|desc` (whitelist полей).
* Все временные метки — ISO-8601 UTC, выставляются сервером.

## 2. Аутентификация

| Метод | Путь | Право | Описание |
|---|---|---|---|
| POST | `/api/auth/login` | — | вход сотрудника; rate limit 5/15мин |
| POST | `/api/auth/logout` | сессия | ревокация текущей сессии |
| GET | `/api/auth/me` | сессия | профиль + список permissions |
| GET | `/api/auth/csrf` | — | выдача CSRF-токена |
| POST | `/api/auth/password` | сессия | смена собственного пароля |

## 3. Приглашения и сессии

| Метод | Путь | Право | Описание |
|---|---|---|---|
| POST | `/api/invitations` | `invitation:write` | создать приглашение; **токен возвращается один раз** |
| GET | `/api/invitations` | `invitation:read` | список с фильтрами `status`, `positionId`, `period` |
| POST | `/api/invitations/:id/resend` | `invitation:write` | новый токен, старый инвалидируется |
| POST | `/api/invitations/:id/cancel` | `invitation:write` | статус `EXPIRED` |
| GET | `/api/invite/:token` | — | публичная карточка приглашения (должность, структура, правила, дедлайн); переводит в `OPENED` |
| POST | `/api/sessions/start` | токен приглашения | создать/продолжить `TestSession`, выдать cookie кандидата |
| GET | `/api/sessions/:id` | кандидат-владелец либо `session:read` | состояние сессии, план секций, текущая позиция, ответы |
| GET | `/api/sessions/:id/next` | кандидат-владелец | следующий вопрос/шаг с учётом Kelly-логики |
| POST | `/api/answers` | кандидат-владелец | сохранить ответ (autosave), вернуть подтверждение и служебные шаги (например, вопрос о дублировании конструкта) |
| POST | `/api/sessions/:id/events` | кандидат-владелец | техжурнал (переключение вкладки, реконнект) |
| POST | `/api/sessions/:id/complete` | кандидат-владелец | завершить, поставить LLM-оценку в очередь |

**Пример.** `POST /api/invitations`

```json
{ "fullName": "Иванов Иван Иванович", "email": "i.ivanov@example.com",
  "positionCode": "MUD_ENGINEER", "assessmentVersionId": "av_01J…",
  "expiresAt": "2026-10-01T18:00:00Z", "maxAttempts": 1 }
```
→ `201`
```json
{ "invitation": { "id": "inv_01J…", "status": "CREATED",
                  "url": "https://host/invite/8f3…", "expiresAt": "…" },
  "warning": "Ссылка отображается один раз. Сохраните её." }
```

**Пример.** `POST /api/answers`

```json
{ "sessionId": "ts_01J…", "questionVersionId": "qv_01J…",
  "value": { "kind": "KELLY_TRIAD",
             "similarPair": ["E1","E3"],
             "similarity": "…", "difference": "…",
             "poleLeft": "…", "poleRight": "…",
             "importanceReason": "…", "rigManifestation": "…",
             "experienceExample": "…" },
  "telemetry": { "shownAt": "…", "firstInputAt": "…", "msActive": 184000 },
  "clientRevision": 3 }
```
→ `200`
```json
{ "saved": true, "revision": 3, "progressPercent": 24,
  "followUp": { "kind": "CONSTRUCT_SIMILARITY_CHECK",
                "checkId": "csc_01J…", "otherConstructId": "cc_01J…",
                "question": "Эти критерии для вас означают одно и то же или являются разными?" } }
```

## 4. Кандидаты, отчёты, review

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/api/candidates` | `candidate:read` | таблица с фильтрами: должность, период, score, компетенция, red flag, статус, confidence |
| GET | `/api/candidates/:id` | `candidate:read` | карточка |
| GET | `/api/candidates/:id/report` | `report:read` | полный отчёт (14 разделов) с evidence и дисклеймерами |
| GET | `/api/candidates/:id/report/drilldown?competencyId=` | `report:read` | вопросы, ответы, цитаты, оба evaluator, rubric, история корректировок |
| POST | `/api/candidates/:id/report/pdf` | `report:read` | поставить генерацию PDF в очередь |
| GET | `/api/reports/:id/file` | `report:read` | pre-signed выдача файла (5 мин) |
| GET | `/api/candidates/:id/export` | `candidate:export_personal` | полный дамп данных кандидата (JSON) |
| POST | `/api/candidates/:id/erase` | `candidate:erase` | обезличивание |
| POST | `/api/candidates/compare` | `report:read` | до 5 id, сравнение без автоматического рейтинга |
| GET | `/api/reviews/queue` | `review:read` | очередь экспертной проверки |
| POST | `/api/reviews` | `review:write` | подтвердить/изменить балл с обязательной причиной |
| POST | `/api/sessions/:id/recompute` | `scoring:recompute` | явный пересчёт с новой версией scoring-модели (создаёт новый `FinalScore`) |
| GET | `/api/sessions/:id/interview-questions` | `report:read` | 5–10 вопросов к очному интервью |
| POST | `/api/candidates/:id/employment-outcome` | `employment_outcome:write` | результаты найма/испытательного срока |

**Пример.** `POST /api/reviews`

```json
{ "dimensionScoreId": "lds_01J…", "humanScore": 3,
  "reviewReason": "Кандидат в ответе 12 явно указал контроль эффекта решения; модель это пропустила.",
  "markedUninformative": false }
```
→ `200` `{ "review": { "modelScore": 2, "humanScore": 3, "finalScore": 3, … },
           "recomputeQueued": true }`

## 5. Конструктор и справочники

| Метод | Путь | Право |
|---|---|---|
| GET/POST | `/api/positions` | `position:read` / `position:write` |
| GET/POST | `/api/competencies` | `competency:read` / `competency:write` |
| GET/POST | `/api/assessments` | `assessment:read` / `assessment:write` |
| POST | `/api/assessments/:id/versions` | `assessment:write` (создать DRAFT) |
| POST | `/api/assessment-versions/:id/clone` | `assessment:write` |
| PATCH | `/api/assessment-versions/:id/weights` | `weights:write` (только DRAFT, сумма=100) |
| PATCH | `/api/assessment-versions/:id/thresholds` | `weights:write` (пороги band, порог расхождения) |
| POST | `/api/assessment-versions/:id/publish` | `assessment_version:publish` (делает immutable) |
| GET/POST/PATCH | `/api/questions`, `/api/question-versions` | `question:*` |
| GET/POST | `/api/scenarios`, `/api/scenarios/:id/stages` | `scenario:*` |
| GET/POST | `/api/kelly/elements`, `/api/kelly/triads` | `assessment:write` |
| GET/POST | `/api/rubrics` | `rubric:*` |
| GET/POST | `/api/scoring-models` | `scoring_model:*` |
| GET/POST | `/api/prompt-templates` | `prompt:*` |

Попытка изменить `PUBLISHED`-версию → `409 CONFLICT`
(`{"code":"VERSION_IMMUTABLE"}`).

## 6. Аналитика, калибровка, аудит, поиск

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/api/analytics` | `analytics:read` | сводка: количество, completion rate, средний score, распределения, слабые компетенции, частота red flags, LLM/human disagreement, средняя длительность |
| GET | `/api/analytics/questions` | `analytics:read` | статистика качества вопросов + флаг «требует методической проверки» |
| GET | `/api/analytics/export?format=csv\|xlsx\|json` | `analytics:export` | агрегаты |
| GET | `/api/calibration` | `calibration:read` | LLM vs human, MAE, bias, распределение расхождений, согласованность экспертов, частота корректировок |
| POST | `/api/calibration/runs` | `calibration:read` | зафиксировать прогон калибровки |
| GET | `/api/benchmarks`, POST | `benchmark:*` | эталонные группы |
| GET | `/api/audit` | `audit:read` | журнал с фильтрами по сущности, действию, пользователю, периоду |
| GET | `/api/search?q=&scope=candidates\|constructs\|answers\|reviews` | `candidate:read` | полнотекстовый поиск (russian) |
| GET | `/api/healthz`, `/api/readyz` | — | проб |
| GET | `/api/openapi.json` | — | спецификация |

## 7. Что API не делает

* не возвращает кандидату его score, red flags, комментарии экспертов и место в
  сравнении (§75);
* не содержит эндпоинта «принять/отказать»;
* не выполняет молчаливый пересчёт исторических результатов — только
  `POST /api/sessions/:id/recompute` с явной записью в audit;
* не отдаёт rubric и `expectedEvidence` кандидатской сессии.
