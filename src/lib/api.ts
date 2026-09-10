/**
 * Клиент API для браузера. Единая точка добавления CSRF-заголовка и
 * обработки формата ошибок (docs/API.md §1).
 */

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown[];
  requestId?: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown[];

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.status = status;
    this.details = error.details ?? [];
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function ensureCsrf(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) return null;
  const data = (await response.json()) as { csrfToken: string | null };
  csrfToken = data.csrfToken;
  return csrfToken;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  if (method !== 'GET') {
    const token = await ensureCsrf();
    if (token) headers['x-csrf-token'] = token;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiRequestError(response.status, {
        code: 'INTERNAL',
        message: `Ответ сервера не в формате JSON (${response.status})`,
      });
    }
    return (await response.blob()) as unknown as T;
  }

  const data = (await response.json()) as T & { error?: ApiErrorShape };
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      data.error ?? { code: 'INTERNAL', message: 'Неизвестная ошибка' },
    );
  }
  return data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    apiRequest<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
};

/** Формирование query-строки без пустых значений. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
