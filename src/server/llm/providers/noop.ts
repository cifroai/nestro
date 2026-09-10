import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';
import { LLMUnavailableError } from '../types.js';

/**
 * Провайдер для окружений без LLM (LLM_PROVIDER=none).
 * Платформа полностью работоспособна: задачи оценки остаются в статусе
 * PENDING, ни одна кандидатская сессия не теряется (§74).
 */
export class NoopProvider implements LLMProvider {
  readonly name = 'noop' as const;
  readonly available = false;

  async complete(_req: LLMRequest): Promise<LLMResponse> {
    throw new LLMUnavailableError();
  }
}
