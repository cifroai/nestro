import type { LLMProvider, LLMRequest, LLMResponse, ProviderName } from '../types.js';
import { LLMProviderError } from '../types.js';

/**
 * Детерминированный провайдер для тестов и интеграционных прогонов.
 * Реальные сетевые вызовы в CI отсутствуют (docs/LLM_ASSESSMENT.md §9).
 */
export type FakeScript = (req: LLMRequest, callIndex: number) => string | Error;

export class FakeProvider implements LLMProvider {
  readonly name: ProviderName = 'fake';
  readonly available = true;
  private callIndex = 0;
  readonly calls: LLMRequest[] = [];

  constructor(private readonly script: FakeScript) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    const result = this.script(req, this.callIndex);
    this.callIndex += 1;
    if (result instanceof Error) {
      if (result instanceof LLMProviderError) throw result;
      throw new LLMProviderError(result.message, { retryable: true });
    }
    return {
      text: result,
      parsed: null,
      model: req.model,
      modelVersion: `${req.model}-fake`,
      usage: { promptTokens: 100, completionTokens: 200 },
      latencyMs: 1,
    };
  }
}
