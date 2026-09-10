/** Абстракция LLM-провайдера (docs/LLM_ASSESSMENT.md §2). Ядро не привязано к API. */

export type ProviderName = 'openai' | 'anthropic' | 'openrouter' | 'local' | 'noop' | 'fake';

export interface JSONSchemaObject {
  type: 'object';
  [key: string]: unknown;
}

export interface LLMRequest {
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  jsonSchema: JSONSchemaObject;
  schemaName: string;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface LLMResponse {
  text: string;
  parsed: unknown | null;
  model: string;
  modelVersion?: string;
  usage: { promptTokens?: number; completionTokens?: number };
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: ProviderName;
  /** true — провайдер способен выполнять запросы (для noop всегда false). */
  readonly available: boolean;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

/** Ошибка провайдера: отличает временный сбой от постоянного. */
export class LLMProviderError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number } = { retryable: true }) {
    super(message);
    this.name = 'LLMProviderError';
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

/** Провайдер не настроен: платформа продолжает работу, оценка остаётся PENDING. */
export class LLMUnavailableError extends LLMProviderError {
  constructor(message = 'LLM-провайдер не настроен: автоматическая оценка отложена') {
    super(message, { retryable: true });
    this.name = 'LLMUnavailableError';
  }
}
