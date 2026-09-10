/**
 * Детерминированный PRNG для рандомизации порядка вопросов и кейсов (§24).
 * Seed сохраняется в TestSession.randomSeed — порядок воспроизводим при
 * расследовании инцидентов и при повторной генерации отчёта.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

/** Перемешивание Фишера—Йетса без мутации входа. */
export function shuffleDeterministic<T>(items: readonly T[], seed: string): T[] {
  const rng = createRng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}

/** Выбор одного элемента из группы эквивалентных вариантов (§24). */
export function pickDeterministic<T>(items: readonly T[], seed: string): T | undefined {
  if (items.length === 0) return undefined;
  const rng = createRng(seed);
  return items[Math.floor(rng() * items.length)];
}
