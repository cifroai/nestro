/**
 * Каталог гранулярных прав и матрица ролей (docs/SECURITY.md §3.1).
 * Единственный источник истины: seed и проверки прав читают этот файл.
 */

export const PERMISSIONS = {
  // Пользователи и доступ
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  ROLE_WRITE: 'role:write',

  // Конструктор ассессментов
  POSITION_READ: 'position:read',
  POSITION_WRITE: 'position:write',
  COMPETENCY_READ: 'competency:read',
  COMPETENCY_WRITE: 'competency:write',
  ASSESSMENT_READ: 'assessment:read',
  ASSESSMENT_WRITE: 'assessment:write',
  ASSESSMENT_VERSION_PUBLISH: 'assessment_version:publish',
  WEIGHTS_WRITE: 'weights:write',
  QUESTION_READ: 'question:read',
  QUESTION_WRITE: 'question:write',
  SCENARIO_READ: 'scenario:read',
  SCENARIO_WRITE: 'scenario:write',
  RUBRIC_READ: 'rubric:read',
  RUBRIC_WRITE: 'rubric:write',
  SCORING_MODEL_READ: 'scoring_model:read',
  SCORING_MODEL_WRITE: 'scoring_model:write',
  PROMPT_READ: 'prompt:read',
  PROMPT_WRITE: 'prompt:write',

  // Кандидаты и прохождение
  INVITATION_READ: 'invitation:read',
  INVITATION_WRITE: 'invitation:write',
  CANDIDATE_READ: 'candidate:read',
  CANDIDATE_WRITE: 'candidate:write',
  CANDIDATE_EXPORT_PERSONAL: 'candidate:export_personal',
  CANDIDATE_ERASE: 'candidate:erase',
  SESSION_READ: 'session:read',

  // Оценка
  REPORT_READ: 'report:read',
  REVIEW_READ: 'review:read',
  REVIEW_WRITE: 'review:write',
  SCORING_RECOMPUTE: 'scoring:recompute',

  // Аналитика
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_EXPORT: 'analytics:export',
  CALIBRATION_READ: 'calibration:read',
  BENCHMARK_READ: 'benchmark:read',
  BENCHMARK_WRITE: 'benchmark:write',

  // Прочее
  EMPLOYMENT_OUTCOME_WRITE: 'employment_outcome:write',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ROLES = {
  SUPER_ADMIN: 'SuperAdmin',
  ASSESSMENT_ADMIN: 'AssessmentAdmin',
  HR: 'HR',
  TECHNICAL_EXPERT: 'TechnicalExpert',
  VIEWER: 'Viewer',
  CANDIDATE: 'Candidate',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

const P = PERMISSIONS;

/**
 * Роль → права. Принцип наименьших прав:
 * HR не имеет доступа к scoring model / rubric / весам;
 * TechnicalExpert не публикует версии ассессмента;
 * Viewer не имеет ни одного *:write и не выгружает персональные данные;
 * Candidate не имеет доступа к административному API вовсе.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,

  [ROLES.ASSESSMENT_ADMIN]: [
    P.USER_READ,
    P.POSITION_READ, P.POSITION_WRITE,
    P.COMPETENCY_READ, P.COMPETENCY_WRITE,
    P.ASSESSMENT_READ, P.ASSESSMENT_WRITE, P.ASSESSMENT_VERSION_PUBLISH, P.WEIGHTS_WRITE,
    P.QUESTION_READ, P.QUESTION_WRITE,
    P.SCENARIO_READ, P.SCENARIO_WRITE,
    P.RUBRIC_READ, P.RUBRIC_WRITE,
    P.SCORING_MODEL_READ, P.SCORING_MODEL_WRITE,
    P.PROMPT_READ, P.PROMPT_WRITE,
    P.INVITATION_READ, P.INVITATION_WRITE,
    P.CANDIDATE_READ, P.SESSION_READ,
    P.REPORT_READ, P.REVIEW_READ, P.SCORING_RECOMPUTE,
    P.ANALYTICS_READ, P.ANALYTICS_EXPORT, P.CALIBRATION_READ,
    P.BENCHMARK_READ, P.BENCHMARK_WRITE,
    P.AUDIT_READ,
  ],

  [ROLES.HR]: [
    P.POSITION_READ, P.COMPETENCY_READ, P.ASSESSMENT_READ, P.QUESTION_READ,
    P.INVITATION_READ, P.INVITATION_WRITE,
    P.CANDIDATE_READ, P.CANDIDATE_WRITE, P.CANDIDATE_EXPORT_PERSONAL,
    P.SESSION_READ, P.REPORT_READ, P.REVIEW_READ,
    P.ANALYTICS_READ, P.ANALYTICS_EXPORT,
    P.BENCHMARK_READ,
  ],

  [ROLES.TECHNICAL_EXPERT]: [
    P.POSITION_READ, P.COMPETENCY_READ, P.ASSESSMENT_READ, P.QUESTION_READ,
    P.SCENARIO_READ, P.RUBRIC_READ,
    P.CANDIDATE_READ, P.SESSION_READ, P.REPORT_READ,
    P.REVIEW_READ, P.REVIEW_WRITE,
    P.ANALYTICS_READ, P.CALIBRATION_READ, P.BENCHMARK_READ,
  ],

  [ROLES.VIEWER]: [
    P.POSITION_READ, P.COMPETENCY_READ, P.ASSESSMENT_READ,
    P.CANDIDATE_READ, P.REPORT_READ, P.ANALYTICS_READ, P.BENCHMARK_READ,
  ],

  [ROLES.CANDIDATE]: [],
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [P.USER_READ]: 'Просмотр списка пользователей',
  [P.USER_WRITE]: 'Создание и изменение пользователей',
  [P.ROLE_WRITE]: 'Изменение ролей и прав',
  [P.POSITION_READ]: 'Просмотр должностей',
  [P.POSITION_WRITE]: 'Изменение должностей',
  [P.COMPETENCY_READ]: 'Просмотр компетенций',
  [P.COMPETENCY_WRITE]: 'Изменение компетенций',
  [P.ASSESSMENT_READ]: 'Просмотр ассессментов',
  [P.ASSESSMENT_WRITE]: 'Изменение ассессментов и черновых версий',
  [P.ASSESSMENT_VERSION_PUBLISH]: 'Публикация версии ассессмента',
  [P.WEIGHTS_WRITE]: 'Изменение весов компетенций и порогов',
  [P.QUESTION_READ]: 'Просмотр вопросов',
  [P.QUESTION_WRITE]: 'Изменение вопросов',
  [P.SCENARIO_READ]: 'Просмотр ситуационных кейсов',
  [P.SCENARIO_WRITE]: 'Изменение ситуационных кейсов',
  [P.RUBRIC_READ]: 'Просмотр rubric',
  [P.RUBRIC_WRITE]: 'Изменение rubric',
  [P.SCORING_MODEL_READ]: 'Просмотр модели скоринга',
  [P.SCORING_MODEL_WRITE]: 'Изменение модели скоринга',
  [P.PROMPT_READ]: 'Просмотр шаблонов промптов',
  [P.PROMPT_WRITE]: 'Изменение шаблонов промптов',
  [P.INVITATION_READ]: 'Просмотр приглашений',
  [P.INVITATION_WRITE]: 'Создание и отзыв приглашений',
  [P.CANDIDATE_READ]: 'Просмотр кандидатов',
  [P.CANDIDATE_WRITE]: 'Изменение данных кандидата',
  [P.CANDIDATE_EXPORT_PERSONAL]: 'Экспорт персональных данных кандидата',
  [P.CANDIDATE_ERASE]: 'Обезличивание и удаление данных кандидата',
  [P.SESSION_READ]: 'Просмотр сессий тестирования',
  [P.REPORT_READ]: 'Просмотр отчётов',
  [P.REVIEW_READ]: 'Просмотр очереди экспертной проверки',
  [P.REVIEW_WRITE]: 'Внесение экспертной оценки',
  [P.SCORING_RECOMPUTE]: 'Явный пересчёт итоговых баллов',
  [P.ANALYTICS_READ]: 'Просмотр аналитики',
  [P.ANALYTICS_EXPORT]: 'Экспорт аналитики',
  [P.CALIBRATION_READ]: 'Просмотр калибровки',
  [P.BENCHMARK_READ]: 'Просмотр эталонных групп',
  [P.BENCHMARK_WRITE]: 'Изменение эталонных групп',
  [P.EMPLOYMENT_OUTCOME_WRITE]: 'Внесение данных после трудоустройства',
  [P.AUDIT_READ]: 'Просмотр журнала аудита',
};

export const ROLE_TITLES: Record<RoleCode, string> = {
  [ROLES.SUPER_ADMIN]: 'Суперадминистратор',
  [ROLES.ASSESSMENT_ADMIN]: 'Администратор ассессментов',
  [ROLES.HR]: 'HR-специалист',
  [ROLES.TECHNICAL_EXPERT]: 'Технический эксперт',
  [ROLES.VIEWER]: 'Наблюдатель',
  [ROLES.CANDIDATE]: 'Кандидат',
};
