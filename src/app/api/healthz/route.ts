import { NextResponse } from 'next/server';

/** Проба живости процесса. Не обращается к внешним зависимостям. */
export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}
