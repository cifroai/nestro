import type { LLMProvider, LLMRequest, LLMResponse, ProviderName } from '../types.js';
import { LLMProviderError } from '../types.js';
import { postJson } from './httpJson.js';

/**
 * Провайдер для OpenAI-совместимого Chat Completions API.
 * Используется для OpenAI, OpenRouter и локальных серверов (vLLM, llama.cpp,
 * Ollama в OpenAI-режиме) — различаются только baseUrl и заголовки.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: ProviderName;
  readonly available = true;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: {
    name: ProviderName;
    baseUrl: string;
    apiKey?: string | undefined;
    extraHeaders?: Record<string, string>;
  }) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const payload = {
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
      },
    };

    const headers: Record<string, string> = { ...this.extraHeaders };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const raw = (await postJson(`${this.baseUrl}/chat/completions`, headers, payload, req.timeoutMs)) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = raw.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new LLMProviderError('Провайдер вернул пустой ответ', { retryable: true });
    }

    return {
      text: content,
      parsed: null,
      model: req.model,
      ...(raw.model ? { modelVersion: raw.model } : {}),
      usage: {
        ...(raw.usage?.prompt_tokens !== undefined ? { promptTokens: raw.usage.prompt_tokens } : {}),
        ...(raw.usage?.completion_tokens !== undefined
          ? { completionTokens: raw.usage.completion_tokens }
          : {}),
      },
      latencyMs: Date.now() - started,
    };
  }
}
