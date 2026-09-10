import { NextResponse } from 'next/server';
import { buildOpenApiDocument } from '@/server/http/openapi.js';
import { getEnv } from '@/server/config/env.js';

/** Машиночитаемая спецификация API (§55). */
export function GET(): NextResponse {
  return NextResponse.json(buildOpenApiDocument(getEnv().APP_URL), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
