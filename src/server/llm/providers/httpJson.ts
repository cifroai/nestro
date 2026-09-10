import { LLMProviderError } from '../types.js';

/** Общий HTTP-помощник провайдеров: таймаут, различение временных ошибок. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      // 408/429/5xx — временные; 4xx (кроме них) — постоянные, повтор бессмыслен.
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new LLMProviderError(
        `Провайдер вернул ${response.status}: ${text.slice(0, 500)}`,
        { retryable, statusCode: response.status },
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LLMProviderError('Провайдер вернул не-JSON тело ответа', { retryable: true });
    }
  } catch (err) {
    if (err instanceof LLMProviderError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LLMProviderError(`Истёк таймаут запроса к провайдеру (${timeoutMs} мс)`, { retryable: true });
    }
    throw new LLMProviderError(`Сетевая ошибка обращения к провайдеру: ${String(err)}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}
