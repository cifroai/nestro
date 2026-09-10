# ARCHITECTURE

## 1. Ключевые архитектурные решения (ADR-сводка)

| # | Решение | Обоснование | Отвергнутая альтернатива |
|---|---|---|---|
| ADR-1 | **Модульный монолит на Next.js 15 (App Router) + отдельный worker-процесс** | Развёртывание на собственном сервере Заказчика силами его IT; один артефакт, одна БД, минимум операционной сложности. Границы модулей соблюдаются на уровне слоёв (`app → services → repositories → prisma`), а не сети. | Отдельный API-сервис (NestJS): +1 деплой, +1 контракт, без выгоды при данном профиле нагрузки. Микросервисы — неоправданны. |
| ADR-2 | **Route Handlers (`/api/*`) как единственный транспорт**, Server Actions не используются для мутаций данных | Один контракт для UI, интеграций и тестов; OpenAPI-документируемость; тестируемость без браузера. | Server Actions — недокументируемы в OpenAPI, тяжело тестировать как API. |
| ADR-3 | **PostgreSQL 16 + Prisma** | Нормализованная модель, транзакции, FTS (`russian`), JSONB для версионируемых снапшотов rubric. | MongoDB — теряем целостность оценок; Drizzle — меньше зрелости миграций для этой команды. |
| ADR-4 | **Session-based auth, opaque token, argon2id** | Нет JWT-инвалидации, простая ревокация, безопасные cookie. | JWT — проблема revocation при увольнении/компромате. |
| ADR-5 | **BullMQ + Redis для очередей** | LLM-оценка и PDF долгие и падающие; нужен retry/backoff/DLQ и независимость от отказа LLM. | Синхронная оценка — теряем сессии при отказе LLM (нарушение §74). |
| ADR-6 | **Scoring — чистый детерминированный модуль без I/O** | §60/§73: детерминизм и unit-тестируемость; LLM-компонент версионируется отдельно. | Скоринг внутри промпта — невоспроизводим и непроверяем. |
| ADR-7 | **LLM возвращает только per-answer суждения, агрегацию делает код** | §2: итоговая оценка не формируется одним LLM-запросом. | Один «финальный» запрос — непрозрачно, невоспроизводимо. |
| ADR-8 | **Свои SVG-компоненты графиков** | Полный контроль над цветовой семантикой (§51: красный только для техпредупреждений), обязательный табличный эквивалент, отсутствие тяжёлых зависимостей, SSR-friendly для PDF. | Recharts/Chart.js — canvas/DOM-зависимости, хуже для PDF и a11y. |
| ADR-9 | **PDF = headless Chromium печатает web-report** | Кириллица, единый источник вёрстки для web и PDF, никакого дублирования шаблонов. | pdfkit/pdf-lib — ручные шрифты и вторая вёрстка отчёта. |
| ADR-10 | **Prisma-схема с `AssessmentVersion` snapshot-полями (JSONB)** | Immutability и воспроизводимость: версия хранит зафиксированный набор вопросов, весов и rubric. | Пересчёт по «живым» справочникам — нарушение §32/§36. |

## 2. Контекстная диаграмма

```mermaid
graph TB
    subgraph Клиенты
        C["Кандидат<br/>браузер desktop/tablet/mobile"]
        H["HR / Эксперт / Админ<br/>браузер desktop-first"]
        X["Внешняя система<br/>REST + OpenAPI"]
    end

    subgraph "Сервер Заказчика (Docker Compose)"
        NG["nginx / reverse proxy<br/>TLS, HSTS, rate limit"]
        APP["app: Next.js 15<br/>App Router + Route Handlers"]
        WRK["worker: BullMQ consumer<br/>LLM assessment, PDF, exports"]
        PG[("postgres:16<br/>нормализованная модель")]
        RD[("redis:7<br/>queues, rate limit, locks")]
        S3[("minio / S3-compatible<br/>PDF, экспорты, вложения")]
    end

    subgraph Внешние
        LLM["LLM Provider<br/>OpenAI | Anthropic | OpenRouter | local"]
        SMTP["SMTP (опционально)"]
    end

    C --> NG
    H --> NG
    X --> NG
    NG --> APP
    APP --> PG
    APP --> RD
    APP --> S3
    APP -.enqueue.-> RD
    RD -.jobs.-> WRK
    WRK --> PG
    WRK --> S3
    WRK -->|"LLMProvider<br/>abstraction"| LLM
    APP --> SMTP
```

## 3. Слои и правила зависимостей

```mermaid
graph LR
    UI["app/** — React Server/Client Components<br/>только представление"]
    API["app/api/** — Route Handlers<br/>authz + zod-валидация + вызов сервиса"]
    SVC["server/services/** — бизнес-логика<br/>транзакции, audit, события"]
    DOM["server/scoring, server/kelly<br/>чистые функции, без I/O"]
    REPO["server/repositories/** — доступ к данным"]
    LLMA["server/llm/** — провайдеры и промпты"]
    DB[("Prisma / PostgreSQL")]

    UI --> API
    API --> SVC
    SVC --> DOM
    SVC --> REPO
    SVC --> LLMA
    REPO --> DB
```

**Жёсткие правила (проверяются ESLint-правилом `no-restricted-imports`):**
* `app/**` не импортирует `@prisma/client` напрямую — только через сервисы;
* `server/scoring/**` и `server/kelly/**` не импортируют ничего из `server/db`,
  `server/llm`, `next/*` — это гарантия детерминизма и тестируемости;
* `server/repositories/**` — единственное место с `prisma.*`;
* LLM-вызовы только из `server/llm/**`, вызываются только из worker-задач;
* компонент UI > 300 строк или смешивающий бизнес-логику — code smell,
  вынос логики в `lib/` или сервис.

## 4. Структура модулей

```
src/
  app/
    (public)/                     страница входа, приглашение кандидата
    (candidate)/t/[sessionId]/    движок теста: секции, автосохранение
    (admin)/
      dashboard/                  HR dashboard
      candidates/[id]/            карточка кандидата + drill-down
      review/                     очередь human review
      compare/                    сравнение до 5 кандидатов
      analytics/                  аналитика, качество вопросов
      calibration/                LLM vs human
      builder/                    конструктор ассессментов
      users/  audit/  settings/
    api/**                        REST + OpenAPI
  components/
    ui/                           примитивы (Button, Table, Field, Dialog…)
    charts/                       Radar, Bar, Heatmap, Scatter, Distribution + TableFallback
    candidate/                    Triad, Grid, Ladder, CaseStage, SelfRating
    report/                       секции отчёта (переиспользуются web + PDF)
  server/
    auth/                         password, session, rbac, permissions
    db/                           prisma client, transaction helper
    repositories/                 typed data access
    services/                     assessment, invitation, testSession, answer,
                                  kelly, scoring, review, report, interviewQuestions,
                                  analytics, calibration, benchmark, export, search,
                                  audit, retention, user
    scoring/                      pure engine (§73) + rubric evaluation
    kelly/                        grid math, similarity, clustering, laddering
    llm/                          provider abstraction, prompts, schemas, evaluator
    queue/                        bullmq queues + job definitions
    http/                         route wrapper, errors, rate limit, request-id
    validation/                   zod schemas (single source for API + OpenAPI)
    logging/                      pino structured logger
    config/                       env validation (zod), feature flags
  lib/                            изоморфные утилиты, i18n-словарь, форматирование
worker/
  index.ts                        BullMQ worker bootstrap
  jobs/                           llmAssessment, finalizeScoring, generatePdf, export
prisma/
  schema.prisma  migrations/  seed/
tests/
  unit/ integration/ api/ permissions/ scoring/ llm/ e2e/
```

## 5. Поток данных: от приглашения до отчёта

```mermaid
sequenceDiagram
    autonumber
    participant HR
    participant API as Next.js API
    participant DB as PostgreSQL
    participant CAND as Кандидат
    participant Q as Redis/BullMQ
    participant W as Worker
    participant L as LLMProvider
    participant EXP as Эксперт

    HR->>API: POST /api/invitations
    API->>DB: Invitation(tokenHash, versionId, deadline)
    API-->>HR: одноразовая ссылка (токен показан один раз)

    CAND->>API: GET /invite/:token  (статус OPENED)
    CAND->>API: POST /api/sessions/start
    API->>DB: TestSession -> AssessmentVersion (immutable snapshot)
    API-->>CAND: план секций, рандомизированный порядок (seed сохранён)

    loop каждый ответ
        CAND->>API: POST /api/answers (autosave)
        API->>DB: Answer + AnswerRevision + телеметрия
    end

    CAND->>API: POST /api/sessions/:id/complete
    API->>DB: status = COMPLETED, assessmentStatus = PENDING
    API->>Q: enqueue llm-assessment (per answer, idempotent)
    API-->>CAND: "Тестирование завершено. Ответы сохранены."

    W->>Q: получить задачу
    W->>DB: ответ + rubric-снапшот версии
    W->>L: Evaluator A (structured JSON)
    W->>L: Evaluator B (независимо, другой промпт/модель)
    W->>DB: LLMAssessment + LLMEvidence (обе оценки)
    W->>Q: enqueue finalize-scoring (когда все ответы обработаны)
    W->>DB: FinalScore + RiskFlag + hard-gates + contradictions
    Note over W,DB: расхождение >= порога -> reviewRequired = true

    EXP->>API: GET /api/candidates/:id/report (drill-down)
    EXP->>API: POST /api/reviews (human_score + reason)
    API->>DB: HumanReview + AuditLog
    API->>Q: enqueue finalize-scoring (пересчёт, явный, версионированный)
```

## 6. Модель безопасности потоков

* **Кандидатская сессия** живёт в отдельном cookie (`nestro_cand`) с иным
  namespace, чем staff-сессия (`nestro_sid`). Кандидатский cookie даёт доступ
  строго к `/api/sessions/:id/*` и `/api/answers` собственной сессии.
* **Ответ кандидата — недоверенные данные.** В LLM он попадает только внутри
  секции `<candidate_answer>` пользовательского сообщения, никогда — в system
  prompt; см. `docs/SECURITY.md` §Prompt Injection.
* **Каждый API-обработчик** обёрнут в `withRoute({ auth, permission, schema })`;
  отсутствие permission — 403 до выполнения бизнес-логики.

## 7. UI/UX принципы

* Корпоративный инженерный минимализм: плотные таблицы, моноширинный шрифт для
  числовых показателей, никаких игровых элементов, эмодзи и «викторинных» бейджей.
* Палитра нейтральная (графит/сталь/индиго-акцент). **Красный — только
  технические предупреждения интерфейса** (ошибка сохранения, истёкшая сессия).
  Уровни компетенций кодируются насыщенностью нейтрального акцента и подписью
  уровня, а не «светофором».
* Admin — desktop-first (min 1280px, работает от 1024px). Candidate UI —
  полностью адаптивный (360px+), одна колонка, крупные поля ввода.
* Все графики имеют переключатель «График / Таблица» (§52).
* Кандидату никогда не показываются баллы, red flags и рейтинг (§75).

## 8. Расширяемость на новые должности

Новая должность добавляется **данными**, без изменения ядра:
1. `Position` (код, название, описание);
2. `Competency` (код, название, ось агрегации, hard-gate флаг);
3. `Assessment` + `AssessmentVersion(DRAFT)` с весами;
4. Kelly-элементы (E1–E10 переопределяемы текстом), триады;
5. `Scenario`/`ScenarioStage` + rubric;
6. публикация версии.

Ядро (scoring, Kelly-математика, LLM-engine, отчёт) параметризуется кодами
компетенций из БД; хардкод должностей отсутствует — проверяется тестом
`tests/integration/newPosition.test.ts`.
