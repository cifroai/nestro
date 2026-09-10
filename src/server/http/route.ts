import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { ZodError } from 'zod';
import { ApiError, badRequest, forbidden, internal, unauthenticated } from './errors.js';
import { buildRequestContext, type RequestContext } from './context.js';
import type { Permission } from '../auth/permissions.js';
import { childLogger } from '../logging/logger.js';
import { consumeRateLimit, RATE_LIMITS, type RateLimitRule } from './rateLimit.js';
import { safeCompare } from '../auth/tokens.js';
import { getEnv } from '../config/env.js';

/**
 * Единая обёртка API-обработчика (docs/ARCHITECTURE.md §6).
 * Порядок: контекст → CSRF → аутентификация → авторизация → rate limit →
 * валидация → бизнес-логика. Отсутствие права даёт 403 ДО обращения к данным.
 */
export type Actor = 'staff' | 'candidate' | 'public';

export interface RouteOptions<TBody, TQuery> {
  actor?: Actor;
  permission?: Permission | Permission[];
  /** true — достаточно одного права из списка (по умолчанию нужны все). */
  anyPermission?: boolean;
  bodySchema?: ZodType<TBody, ZodTypeDef, unknown>;
  querySchema?: ZodType<TQuery, ZodTypeDef, unknown>;
  rateLimit?: { rule: keyof typeof RATE_LIMITS; keyOf?: (ctx: RequestContext) => string };
  /** Отключение CSRF допустимо только для публичного логина с проверкой Origin. */
  skipCsrf?: boolean;
}

export interface Handler<TBody, TQuery, TParams> {
  (input: {
    ctx: RequestContext;
    body: TBody;
    query: TQuery;
    params: TParams;
    request: Request;
  }): Promise<unknown>;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function errorResponse(err: ApiError, requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    },
    { status: err.status, headers: { 'x-request-id': requestId } },
  );
}

function assertOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // не браузерный запрос (интеграция) — CSRF не применим
  const appUrl = getEnv().APP_URL;
  try {
    if (new URL(origin).origin !== new URL(appUrl).origin) {
      throw forbidden('Недопустимый источник запроса');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw forbidden('Недопустимый источник запроса');
  }
}

function assertCsrf(request: Request, ctx: RequestContext): void {
  const provided = request.headers.get('x-csrf-token');
  const secret = ctx.user?.csrfSecret ?? ctx.candidate?.csrfSecret;
  if (!secret) return; // неаутентифицированные небезопасные запросы защищены Origin
  if (!provided || !safeCompare(provided, secret)) {
    throw forbidden('Отсутствует или неверен CSRF-токен');
  }
}

function checkPermissions(ctx: RequestContext, opts: RouteOptions<unknown, unknown>): void {
  if (!opts.permission) return;
  const required = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
  const held = new Set(ctx.user?.permissions ?? []);
  const ok = opts.anyPermission
    ? required.some((p) => held.has(p))
    : required.every((p) => held.has(p));
  if (!ok) {
    throw forbidden(`Недостаточно прав: требуется ${required.join(', ')}`);
  }
}

export function withRoute<TBody = undefined, TQuery = undefined, TParams = Record<string, string>>(
  options: RouteOptions<TBody, TQuery>,
  handler: Handler<TBody, TQuery, TParams>,
) {
  return async function route(
    request: Request,
    routeCtx?: { params: Promise<TParams> },
  ): Promise<NextResponse> {
    let requestId = 'unknown';
    try {
      const ctx = await buildRequestContext();
      requestId = ctx.requestId;

      if (UNSAFE_METHODS.has(request.method)) {
        assertOrigin(request);
        if (!options.skipCsrf) assertCsrf(request, ctx);
      }

      const actor = options.actor ?? 'staff';
      if (actor === 'staff' && !ctx.user) throw unauthenticated();
      if (actor === 'candidate' && !ctx.candidate) throw unauthenticated('Требуется сессия кандидата');
      checkPermissions(ctx, options as RouteOptions<unknown, unknown>);

      if (options.rateLimit) {
        const preset = RATE_LIMITS[options.rateLimit.rule];
        const keyPart = options.rateLimit.keyOf
          ? options.rateLimit.keyOf(ctx)
          : (ctx.user?.id ?? ctx.candidate?.testSessionId ?? ctx.ip ?? 'anonymous');
        const rule: RateLimitRule = {
          key: `${options.rateLimit.rule}:${keyPart}`,
          limit: preset.limit,
          windowSeconds: preset.windowSeconds,
        };
        await consumeRateLimit(rule);
      }

      let body = undefined as TBody;
      if (options.bodySchema) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          throw badRequest('Ожидается корректный JSON в теле запроса');
        }
        body = options.bodySchema.parse(raw);
      }

      let query = undefined as TQuery;
      if (options.querySchema) {
        const url = new URL(request.url);
        query = options.querySchema.parse(Object.fromEntries(url.searchParams.entries()));
      }

      const params = routeCtx?.params ? await routeCtx.params : ({} as TParams);
      const result = await handler({ ctx, body, query, params, request });

      if (result instanceof NextResponse) return result;
      const status = request.method === 'POST' ? 201 : 200;
      return NextResponse.json(result ?? { ok: true }, {
        status: result === undefined ? 204 : status,
        headers: { 'x-request-id': requestId },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) childLogger({ requestId }).error({ err }, 'api error');
        else childLogger({ requestId }).warn({ code: err.code, message: err.message }, 'api rejected');
        return errorResponse(err, requestId);
      }
      if (err instanceof ZodError) {
        return errorResponse(
          badRequest(
            'Ошибка валидации данных',
            err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
          requestId,
        );
      }
      childLogger({ requestId }).error({ err }, 'unhandled api error');
      return errorResponse(internal(), requestId);
    }
  };
}
