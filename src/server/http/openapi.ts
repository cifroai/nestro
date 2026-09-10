import { zodToJsonSchema } from './zodToJsonSchema.js';
import {
  auditListSchema,
  benchmarkSchema,
  calibrationRunSchema,
  candidateListSchema,
  changePasswordSchema,
  compareSchema,
  createInvitationSchema,
  createUserSchema,
  employmentOutcomeSchema,
  exportSchema,
  invitationListSchema,
  loginSchema,
  resendInvitationSchema,
  reviewSchema,
  searchSchema,
  sessionEventSchema,
  startSessionSchema,
  thresholdsSchema,
  updateRolesSchema,
  weightsSchema,
} from '../validation/common.js';
import { saveAnswerSchema } from '../validation/answers.js';

/**
 * Спецификация OpenAPI (§55). Схемы генерируются из тех же Zod-объектов,
 * которыми валидируются запросы, — расхождение контракта и реализации
 * исключено по построению.
 */

interface Operation {
  summary: string;
  description?: string;
  tags: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

const errorResponse = {
  description: 'Ошибка',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHENTICATED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'VERSION_IMMUTABLE',
                  'GONE',
                  'RATE_LIMITED',
                  'LLM_UNAVAILABLE',
                  'INTERNAL',
                ],
              },
              message: { type: 'string' },
              details: { type: 'array', items: {} },
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const ok = (description: string) => ({
  description,
  content: { 'application/json': { schema: { type: 'object' } } },
});

function body(schema: unknown) {
  return { required: true, content: { 'application/json': { schema } } };
}

function queryParams(schema: { properties?: Record<string, unknown>; required?: string[] }): unknown[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([name, definition]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: definition,
  }));
}

const pathParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const staffSecurity = [{ staffSession: [] }];
const candidateSecurity = [{ candidateSession: [] }];

const commonResponses = {
  '400': errorResponse,
  '401': errorResponse,
  '403': errorResponse,
  '404': errorResponse,
  '429': errorResponse,
};

export function buildOpenApiDocument(appUrl: string): object {
  const paths: Record<string, Record<string, Operation>> = {
    '/api/auth/login': {
      post: {
        summary: 'Вход сотрудника',
        description: 'Ограничение частоты: 5 попыток за 15 минут на IP.',
        tags: ['Аутентификация'],
        requestBody: body(zodToJsonSchema(loginSchema)),
        responses: { '201': ok('Сессия создана'), ...commonResponses },
      },
    },
    '/api/auth/logout': {
      post: {
        summary: 'Выход',
        description: 'Ресурс не создаётся, поэтому статус 200, а не 201.',
        tags: ['Аутентификация'],
        security: staffSecurity,
        responses: { '200': ok('Сессия завершена'), ...commonResponses },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Профиль и права текущего пользователя',
        tags: ['Аутентификация'],
        security: staffSecurity,
        responses: { '200': ok('Профиль'), ...commonResponses },
      },
    },
    '/api/auth/csrf': {
      get: {
        summary: 'CSRF-токен текущей сессии',
        tags: ['Аутентификация'],
        responses: { '200': ok('Токен'), ...commonResponses },
      },
    },
    '/api/auth/password': {
      post: {
        summary: 'Смена собственного пароля',
        tags: ['Аутентификация'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(changePasswordSchema)),
        responses: { '201': ok('Пароль изменён'), ...commonResponses },
      },
    },

    '/api/invitations': {
      get: {
        summary: 'Список приглашений',
        tags: ['Приглашения'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(invitationListSchema)),
        responses: { '200': ok('Список'), ...commonResponses },
      },
      post: {
        summary: 'Создать приглашение',
        description: 'Ссылка с токеном возвращается ровно один раз и не хранится в открытом виде.',
        tags: ['Приглашения'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(createInvitationSchema)),
        responses: { '201': ok('Приглашение создано'), ...commonResponses },
      },
    },
    '/api/invitations/{id}/resend': {
      post: {
        summary: 'Перевыпустить приглашение',
        description: 'Прежний токен становится недействительным.',
        tags: ['Приглашения'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор приглашения')],
        requestBody: body(zodToJsonSchema(resendInvitationSchema)),
        responses: { '201': ok('Новая ссылка'), ...commonResponses },
      },
    },
    '/api/invitations/{id}/cancel': {
      post: {
        summary: 'Отозвать приглашение',
        tags: ['Приглашения'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор приглашения')],
        responses: { '201': ok('Отозвано'), ...commonResponses },
      },
    },
    '/api/invite/{token}': {
      get: {
        summary: 'Публичная карточка приглашения',
        description: 'Должность, структура теста, правила и срок. Данных оценки не содержит.',
        tags: ['Кандидат'],
        parameters: [pathParam('token', 'Одноразовый токен приглашения')],
        responses: { '200': ok('Карточка приглашения'), '410': errorResponse, ...commonResponses },
      },
    },

    '/api/sessions/start': {
      post: {
        summary: 'Начать или продолжить прохождение',
        tags: ['Кандидат'],
        requestBody: body(zodToJsonSchema(startSessionSchema)),
        responses: { '201': ok('Сессия и состояние'), '410': errorResponse, ...commonResponses },
      },
    },
    '/api/sessions/{id}': {
      get: {
        summary: 'Состояние сессии',
        description: 'Доступно кандидату-владельцу либо сотруднику с правом session:read.',
        tags: ['Кандидат'],
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '200': ok('Состояние'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/next': {
      get: {
        summary: 'Следующий шаг прохождения',
        tags: ['Кандидат'],
        security: candidateSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '200': ok('Шаг'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/events': {
      post: {
        summary: 'Технический журнал сессии',
        description: 'Диагностический журнал; кадровых выводов не влечёт.',
        tags: ['Кандидат'],
        security: candidateSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        requestBody: body(zodToJsonSchema(sessionEventSchema)),
        responses: { '201': ok('Записано'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/complete': {
      post: {
        summary: 'Завершить тестирование',
        description: 'Кандидату не возвращаются баллы, маркеры риска и рейтинг.',
        tags: ['Кандидат'],
        security: candidateSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '201': ok('Завершено'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/recompute': {
      post: {
        summary: 'Явный пересчёт итоговых баллов',
        description: 'Создаёт новые записи FinalScore; исторические сохраняются.',
        tags: ['Оценка'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '201': ok('Пересчёт выполнен или поставлен в очередь'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/review-complete': {
      post: {
        summary: 'Завершить экспертную проверку сессии',
        tags: ['Оценка'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '201': ok('Проверка завершена'), ...commonResponses },
      },
    },
    '/api/sessions/{id}/interview-questions': {
      get: {
        summary: 'Вопросы к очному собеседованию',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '200': ok('Вопросы'), ...commonResponses },
      },
      post: {
        summary: 'Сформировать вопросы заново',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор сессии')],
        responses: { '201': ok('Сформировано'), ...commonResponses },
      },
    },

    '/api/answers': {
      post: {
        summary: 'Сохранить ответ',
        description:
          'Автосохранение (DRAFT) и окончательная отправка (SUBMITTED). ' +
          'Каждое сохранение создаёт ревизию.',
        tags: ['Кандидат'],
        security: candidateSecurity,
        requestBody: body(zodToJsonSchema(saveAnswerSchema)),
        responses: { '201': ok('Сохранено'), ...commonResponses },
      },
    },

    '/api/candidates': {
      get: {
        summary: 'Список кандидатов с фильтрами',
        tags: ['Кандидаты'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(candidateListSchema)),
        responses: { '200': ok('Список'), ...commonResponses },
      },
    },
    '/api/candidates/dashboard': {
      get: {
        summary: 'Счётчики дашборда',
        tags: ['Кандидаты'],
        security: staffSecurity,
        responses: { '200': ok('Счётчики'), ...commonResponses },
      },
    },
    '/api/candidates/{id}': {
      get: {
        summary: 'Карточка кандидата',
        tags: ['Кандидаты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор кандидата')],
        responses: { '200': ok('Карточка'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/report': {
      get: {
        summary: 'Полный отчёт по кандидату',
        description: 'Каждый балл сопровождается доказательствами; кадрового вердикта нет.',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [
          pathParam('id', 'Идентификатор кандидата'),
          { name: 'sessionId', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': ok('Отчёт'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/report/drilldown': {
      get: {
        summary: 'Раскрытие балла компетенции',
        description: 'Вопросы, ответы, цитаты, оценки обоих оценщиков, rubric, история правок.',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [
          pathParam('id', 'Идентификатор кандидата'),
          { name: 'competencyCode', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'sessionId', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': ok('Детализация'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/report/pdf': {
      post: {
        summary: 'Сформировать PDF-отчёт',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор кандидата')],
        responses: { '201': ok('Поставлено в очередь или сформировано'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/export': {
      get: {
        summary: 'Экспорт данных кандидата',
        description: 'Требует права candidate:export_personal; фиксируется в журнале аудита.',
        tags: ['Экспорт'],
        security: staffSecurity,
        parameters: [
          pathParam('id', 'Идентификатор кандидата'),
          { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'xlsx'] } },
        ],
        responses: { '200': { description: 'Файл' }, ...commonResponses },
      },
    },
    '/api/candidates/{id}/erase': {
      post: {
        summary: 'Обезличить данные кандидата',
        tags: ['Персональные данные'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор кандидата')],
        responses: { '201': ok('Обезличено'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/employment-outcome': {
      post: {
        summary: 'Внести данные после трудоустройства',
        tags: ['Кандидаты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор кандидата')],
        requestBody: body(zodToJsonSchema(employmentOutcomeSchema)),
        responses: { '201': ok('Сохранено'), ...commonResponses },
      },
    },
    '/api/candidates/{id}/benchmark': {
      get: {
        summary: 'Сравнение с эталонной группой',
        tags: ['Кандидаты'],
        security: staffSecurity,
        parameters: [
          pathParam('id', 'Идентификатор кандидата'),
          { name: 'benchmarkCode', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': ok('Сравнение'), ...commonResponses },
      },
    },
    '/api/candidates/compare': {
      post: {
        summary: 'Сравнение до пяти кандидатов',
        description: 'Автоматический рейтинг по итоговому баллу не формируется.',
        tags: ['Кандидаты'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(compareSchema)),
        responses: { '201': ok('Сравнение'), ...commonResponses },
      },
    },

    '/api/reviews': {
      post: {
        summary: 'Экспертная оценка',
        description: 'Сохраняются model_score, human_score, final_score и причина изменения.',
        tags: ['Оценка'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(reviewSchema)),
        responses: { '201': ok('Сохранено'), ...commonResponses },
      },
    },
    '/api/reviews/queue': {
      get: {
        summary: 'Очередь экспертной проверки',
        tags: ['Оценка'],
        security: staffSecurity,
        responses: { '200': ok('Очередь'), ...commonResponses },
      },
    },
    '/api/risk-flags/{id}': {
      post: {
        summary: 'Подтвердить или снять маркер риска',
        tags: ['Оценка'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор маркера')],
        responses: { '201': ok('Обновлено'), ...commonResponses },
      },
    },
    '/api/reports/{id}/file': {
      get: {
        summary: 'Файл отчёта',
        description: 'Файлы не публикуются; доступ только с правом report:read.',
        tags: ['Отчёты'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор отчёта')],
        responses: { '200': { description: 'PDF-файл' }, ...commonResponses },
      },
    },

    '/api/assessments': {
      get: {
        summary: 'Список ассессментов',
        tags: ['Конструктор'],
        security: staffSecurity,
        responses: { '200': ok('Список'), ...commonResponses },
      },
      post: {
        summary: 'Создать ассессмент',
        tags: ['Конструктор'],
        security: staffSecurity,
        responses: { '201': ok('Создан'), ...commonResponses },
      },
    },
    '/api/assessment-versions': {
      get: {
        summary: 'Опубликованные версии',
        tags: ['Конструктор'],
        security: staffSecurity,
        responses: { '200': ok('Версии'), ...commonResponses },
      },
    },
    '/api/assessment-versions/{id}': {
      get: {
        summary: 'Полная конфигурация версии',
        tags: ['Конструктор'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор версии')],
        responses: { '200': ok('Конфигурация'), ...commonResponses },
      },
    },
    '/api/assessment-versions/{id}/weights': {
      patch: {
        summary: 'Изменить веса компетенций',
        description: 'Только для черновой версии; сумма весов должна быть равна 100.',
        tags: ['Конструктор'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор версии')],
        requestBody: body(zodToJsonSchema(weightsSchema)),
        responses: { '200': ok('Обновлено'), '409': errorResponse, ...commonResponses },
      },
    },
    '/api/assessment-versions/{id}/thresholds': {
      patch: {
        summary: 'Изменить пороги и параметры оценки',
        tags: ['Конструктор'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор версии')],
        requestBody: body(zodToJsonSchema(thresholdsSchema)),
        responses: { '200': ok('Обновлено'), '409': errorResponse, ...commonResponses },
      },
    },
    '/api/assessment-versions/{id}/publish': {
      post: {
        summary: 'Опубликовать версию',
        description: 'После публикации версия неизменяема.',
        tags: ['Конструктор'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор версии')],
        responses: { '201': ok('Опубликовано'), '409': errorResponse, ...commonResponses },
      },
    },
    '/api/assessment-versions/{id}/clone': {
      post: {
        summary: 'Клонировать версию в черновик',
        tags: ['Конструктор'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор версии')],
        responses: { '201': ok('Создана новая версия'), ...commonResponses },
      },
    },

    '/api/analytics': {
      get: {
        summary: 'Сводная аналитика',
        tags: ['Аналитика'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(exportSchema)),
        responses: { '200': ok('Аналитика'), ...commonResponses },
      },
    },
    '/api/analytics/questions': {
      get: {
        summary: 'Статистика качества вопросов',
        description: 'Отметка «требует методической проверки»; автоудаления вопросов нет.',
        tags: ['Аналитика'],
        security: staffSecurity,
        responses: { '200': ok('Статистика'), ...commonResponses },
      },
    },
    '/api/analytics/export': {
      get: {
        summary: 'Экспорт агрегатов',
        tags: ['Экспорт'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(exportSchema)),
        responses: { '200': { description: 'Файл' }, ...commonResponses },
      },
    },
    '/api/calibration': {
      get: {
        summary: 'Калибровка модельных и экспертных оценок',
        description: 'Веса модели автоматически не изменяются.',
        tags: ['Калибровка'],
        security: staffSecurity,
        responses: { '200': ok('Метрики'), ...commonResponses },
      },
    },
    '/api/calibration/runs': {
      get: {
        summary: 'История прогонов калибровки',
        tags: ['Калибровка'],
        security: staffSecurity,
        responses: { '200': ok('Прогоны'), ...commonResponses },
      },
      post: {
        summary: 'Зафиксировать прогон калибровки',
        tags: ['Калибровка'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(calibrationRunSchema)),
        responses: { '201': ok('Зафиксировано'), ...commonResponses },
      },
    },
    '/api/benchmarks': {
      get: {
        summary: 'Эталонные группы',
        tags: ['Аналитика'],
        security: staffSecurity,
        responses: { '200': ok('Группы'), ...commonResponses },
      },
      post: {
        summary: 'Создать или обновить эталонную группу',
        tags: ['Аналитика'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(benchmarkSchema)),
        responses: { '201': ok('Сохранено'), ...commonResponses },
      },
    },
    '/api/audit': {
      get: {
        summary: 'Журнал аудита',
        tags: ['Аудит'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(auditListSchema)),
        responses: { '200': ok('Записи'), ...commonResponses },
      },
    },
    '/api/search': {
      get: {
        summary: 'Полнотекстовый поиск',
        tags: ['Поиск'],
        security: staffSecurity,
        parameters: queryParams(zodToJsonSchema(searchSchema)),
        responses: { '200': ok('Результаты'), ...commonResponses },
      },
    },
    '/api/users': {
      get: {
        summary: 'Пользователи',
        tags: ['Пользователи'],
        security: staffSecurity,
        responses: { '200': ok('Список'), ...commonResponses },
      },
      post: {
        summary: 'Создать пользователя',
        tags: ['Пользователи'],
        security: staffSecurity,
        requestBody: body(zodToJsonSchema(createUserSchema)),
        responses: { '201': ok('Создан'), ...commonResponses },
      },
    },
    '/api/users/{id}/roles': {
      patch: {
        summary: 'Изменить роли пользователя',
        description: 'Активные сессии пользователя отзываются немедленно.',
        tags: ['Пользователи'],
        security: staffSecurity,
        parameters: [pathParam('id', 'Идентификатор пользователя')],
        requestBody: body(zodToJsonSchema(updateRolesSchema)),
        responses: { '200': ok('Обновлено'), ...commonResponses },
      },
    },
    '/api/healthz': {
      get: {
        summary: 'Проба живости',
        tags: ['Служебные'],
        responses: { '200': ok('ok') },
      },
    },
    '/api/readyz': {
      get: {
        summary: 'Проба готовности',
        description: 'Проверяет доступность БД, применённость миграций и доступность Redis.',
        tags: ['Служебные'],
        responses: { '200': ok('ready'), '503': ok('not-ready') },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Nestro Assessment Platform API',
      version: '1.0.0',
      description:
        'API платформы дистанционной оценки инженерного персонала бурового сервиса. ' +
        'Система является инструментом поддержки решения: кадровые решения принимает человек. ' +
        'В API отсутствуют операции «принять» и «отказать», а кандидату не возвращаются ' +
        'баллы, маркеры риска и сравнительный рейтинг.',
    },
    servers: [{ url: appUrl }],
    tags: [
      { name: 'Аутентификация' },
      { name: 'Приглашения' },
      { name: 'Кандидат', description: 'Прохождение тестирования' },
      { name: 'Кандидаты', description: 'Работа HR и экспертов с кандидатами' },
      { name: 'Оценка' },
      { name: 'Отчёты' },
      { name: 'Конструктор' },
      { name: 'Аналитика' },
      { name: 'Калибровка' },
      { name: 'Экспорт' },
      { name: 'Персональные данные' },
      { name: 'Аудит' },
      { name: 'Поиск' },
      { name: 'Пользователи' },
      { name: 'Служебные' },
    ],
    components: {
      securitySchemes: {
        staffSession: { type: 'apiKey', in: 'cookie', name: 'nestro_sid' },
        candidateSession: { type: 'apiKey', in: 'cookie', name: 'nestro_cand' },
      },
    },
    paths,
  };
}
