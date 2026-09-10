import { getEnv } from '../config/env.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { NoopProvider } from './providers/noop.js';
import { OpenAICompatibleProvider } from './providers/openaiCompatible.js';
import type { LLMProvider } from './types.js';

/**
 * Единственная точка выбора провайдера (docs/LLM_ASSESSMENT.md §2).
 * Ключи читаются только из окружения и только в процессе worker.
 */
let override: LLMProvider | null = null;

export function createProvider(): LLMProvider {
  if (override) return override;
  const env = getEnv();

  switch (env.LLM_PROVIDER) {
    case 'openai':
      if (!env.LLM_API_KEY) return new NoopProvider();
      return new OpenAICompatibleProvider({
        name: 'openai',
        baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: env.LLM_API_KEY,
      });

    case 'openrouter':
      if (!env.LLM_API_KEY) return new NoopProvider();
      return new OpenAICompatibleProvider({
        name: 'openrouter',
        baseUrl: env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey: env.LLM_API_KEY,
        extraHeaders: { 'http-referer': env.APP_URL, 'x-title': 'Nestro Assessment' },
      });

    case 'local':
      // Локальная модель (vLLM / llama.cpp / Ollama в OpenAI-режиме).
      return new OpenAICompatibleProvider({
        name: 'local',
        baseUrl: env.LLM_BASE_URL ?? 'http://localhost:8000/v1',
        apiKey: env.LLM_API_KEY,
      });

    case 'anthropic':
      if (!env.LLM_API_KEY) return new NoopProvider();
      return new AnthropicProvider({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL });

    case 'none':
    default:
      return new NoopProvider();
  }
}

/** Подмена провайдера в тестах и интеграционных прогонах. */
export function setProviderOverride(provider: LLMProvider | null): void {
  override = provider;
}

export function resolveModels(): { primary: string; secondary: string | null } {
  const env = getEnv();
  const primary = env.LLM_MODEL_PRIMARY ?? 'unset-primary-model';
  const secondary = env.LLM_MODEL_SECONDARY ?? null;
  return { primary, secondary };
}
