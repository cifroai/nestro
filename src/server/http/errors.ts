/** Единый формат ошибок API (docs/API.md §1). */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_IMMUTABLE'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'LLM_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_IMMUTABLE: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown[];

  constructor(code: ApiErrorCode, message: string, details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const badRequest = (m: string, d: unknown[] = []) => new ApiError('VALIDATION_ERROR', m, d);
export const unauthenticated = (m = 'Требуется аутентификация') => new ApiError('UNAUTHENTICATED', m);
export const forbidden = (m = 'Недостаточно прав') => new ApiError('FORBIDDEN', m);
export const notFound = (m = 'Объект не найден') => new ApiError('NOT_FOUND', m);
export const conflict = (m: string) => new ApiError('CONFLICT', m);
export const versionImmutable = (m = 'Опубликованная версия ассессмента неизменяема') =>
  new ApiError('VERSION_IMMUTABLE', m);
export const gone = (m: string) => new ApiError('GONE', m);
export const rateLimited = (m = 'Слишком много запросов, повторите позже') =>
  new ApiError('RATE_LIMITED', m);
export const internal = (m = 'Внутренняя ошибка') => new ApiError('INTERNAL', m);
