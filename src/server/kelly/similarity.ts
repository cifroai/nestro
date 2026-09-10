import { cosineSimilarity, tokenize } from './text.js';
import { round3 } from '../scoring/round.js';

/**
 * Детекция потенциально дублирующих конструктов (docs/KELLY_METHOD.md §4).
 * Система только ЗАДАЁТ ВОПРОС кандидату; автоматическое слияние запрещено (§5).
 */

export interface ConstructTextSnapshot {
  id: string;
  poleLeft: string;
  poleRight: string;
  importanceReason?: string | null;
  rigManifestation?: string | null;
}

export interface SimilarityResult {
  otherConstructId: string;
  lexicalScore: number;
  /** true — полюса совпали в инвертированном порядке (левый↔правый). */
  polesInverted: boolean;
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.62;

const POLE_WEIGHT = 0.6;
const CONTEXT_WEIGHT = 0.4;

function contextTokens(c: ConstructTextSnapshot): string[] {
  return tokenize(`${c.importanceReason ?? ''} ${c.rigManifestation ?? ''}`);
}

export function lexicalSimilarity(
  a: ConstructTextSnapshot,
  b: ConstructTextSnapshot,
): { score: number; polesInverted: boolean } {
  const aLeft = tokenize(a.poleLeft);
  const aRight = tokenize(a.poleRight);
  const bLeft = tokenize(b.poleLeft);
  const bRight = tokenize(b.poleRight);

  const direct = Math.max(cosineSimilarity(aLeft, bLeft), cosineSimilarity(aRight, bRight));
  const inverted = Math.max(cosineSimilarity(aLeft, bRight), cosineSimilarity(aRight, bLeft));
  const maxPoleSim = Math.max(direct, inverted);

  const contextSim = cosineSimilarity(contextTokens(a), contextTokens(b));
  const score = POLE_WEIGHT * maxPoleSim + CONTEXT_WEIGHT * contextSim;

  return { score: round3(score), polesInverted: inverted > direct };
}

/**
 * Возвращает наиболее близкий существующий конструкт, если превышен порог.
 * Ответ используется, чтобы задать кандидату нейтральный вопрос о различии.
 */
export function findPotentialDuplicate(
  candidate: ConstructTextSnapshot,
  existing: ConstructTextSnapshot[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): SimilarityResult | null {
  let best: SimilarityResult | null = null;
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    const { score, polesInverted } = lexicalSimilarity(candidate, other);
    if (score < threshold) continue;
    if (!best || score > best.lexicalScore) {
      best = { otherConstructId: other.id, lexicalScore: score, polesInverted };
    }
  }
  return best;
}

export const DUPLICATE_QUESTION =
  'Эти критерии для вас означают одно и то же или являются разными?';
