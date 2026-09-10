import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';
import { LLMProviderError } from '../types.js';
import { postJson } from './httpJson.js';

/**
 * Провайдер Anthropic Messages API. Структурированный вывод обеспечивается
 * через tool-схему с forced tool choice: модель обязана вернуть объект,
 * соответствующий JSON Schema.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly available = true;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion = '2023-06-01';

  constructor(options: { apiKey: string; baseUrl?: string | undefined }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const toolName = req.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const payload = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          name: toolName,
          description: 'Вернуть результат оценки строго по схеме',
          input_schema: req.jsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
    };

    const raw = (await postJson(
      `${this.baseUrl}/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': this.apiVersion },
      payload,
      req.timeoutMs,
    )) as {
      model?: string;
      content?: Array<{ type: string; input?: unknown; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const toolUse = raw.content?.find((c) => c.type === 'tool_use');
    if (!toolUse?.input) {
      const text = raw.content?.find((c) => c.type === 'text')?.text;
      if (typeof text === 'string' && text.length > 0) {
        // Модель ответила текстом вместо вызова инструмента — валидатор решит.
        return {
          text,
          parsed: null,
          model: req.model,
          ...(raw.model ? { modelVersion: raw.model } : {}),
          usage: {},
          latencyMs: Date.now() - started,
        };
      }
      throw new LLMProviderError('Ответ не содержит структурированного результата', { retryable: true });
    }

    return {
      text: JSON.stringify(toolUse.input),
      parsed: toolUse.input,
      model: req.model,
      ...(raw.model ? { modelVersion: raw.model } : {}),
      usage: {
        ...(raw.usage?.input_tokens !== undefined ? { promptTokens: raw.usage.input_tokens } : {}),
        ...(raw.usage?.output_tokens !== undefined ? { completionTokens: raw.usage.output_tokens } : {}),
      },
      latencyMs: Date.now() - started,
    };
  }
}
