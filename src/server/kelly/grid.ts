import { clamp01, mean, round3 } from '../scoring/round.js';

/**
 * Математика репертуарной решётки (docs/KELLY_METHOD.md §7, §21 требований).
 *
 * ВАЖНО: статистические расстояния описывают структуру ответов кандидата и
 * НЕ являются психологическим диагнозом. Все выводы сопровождаются
 * дисклеймером GRID_DISCLAIMER и табличным представлением исходных значений.
 */

export const GRID_ENGINE_VERSION = '1.0.0';

export const GRID_DISCLAIMER =
  'Статистические расстояния и кластеры описывают структуру ответов кандидата ' +
  'и не являются психологическим диагнозом. Они не используются как ' +
  'самостоятельное основание кадрового решения.';

export const SCALE_MIN = 1;
export const SCALE_MAX = 7;
export const SCALE_RANGE = SCALE_MAX - SCALE_MIN; // 6

export interface GridRow {
  constructId: string;
  poleLeft: string;
  poleRight: string;
  /** Оценки по элементам в порядке elementCodes; null — не заполнено. */
  values: Array<number | null>;
}

export interface GridMatrix {
  elementCodes: string[];
  rows: GridRow[];
  selfElementCode: string;
  idealElementCode: string;
  bestElementCode?: string;
  weakElementCode?: string;
}

export interface ElementDistance {
  fromElement: string;
  toElement: string;
  manhattan: number;
  manhattanNormalized: number;
  euclidean: number;
  euclideanNormalized: number;
  comparedConstructs: number;
}

export interface ConstructPairSimilarity {
  constructAId: string;
  constructBId: string;
  correlation: number | null;
  cosine: number | null;
  /** true — связь обратная (высокая |r| при отрицательном знаке). */
  inverted: boolean;
  potentialDuplicate: boolean;
}

export interface ConstructCluster {
  members: string[];
  averageAbsCorrelation: number;
}

export interface GridMetrics {
  engineVersion: string;
  disclaimer: string;
  constructCount: number;
  elementCount: number;
  filledCells: number;
  totalCells: number;
  distances: {
    selfToIdeal: ElementDistance | null;
    selfToBest: ElementDistance | null;
    selfToWeak: ElementDistance | null;
    all: ElementDistance[];
  };
  constructSimilarity: ConstructPairSimilarity[];
  clusters: ConstructCluster[];
  potentialDuplicatePairs: ConstructPairSimilarity[];
  polarization: number;
  extremeShare: number;
  midpointShare: number;
  distribution: Record<string, number>;
  /** Доля сильно связанных пар с противоположной оценкой идеального элемента. */
  inconsistencyShare: number;
  /** Нормированный разрыв «Я сейчас» ↔ «Идеальный инженер», 0..1. */
  selfIdealGap: number | null;
  /** Сигнал профессиональной рефлексии (docs/SCORING.md §11). */
  reflectionSignal: number | null;
  constructSignificance: Array<{
    constructId: string;
    discriminationPower: number;
    selfIdealDistance: number;
    significance: number;
  }>;
}

function columnIndex(matrix: GridMatrix, elementCode: string): number {
  return matrix.elementCodes.indexOf(elementCode);
}

function pairedValues(
  matrix: GridMatrix,
  fromIdx: number,
  toIdx: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const row of matrix.rows) {
    const a = row.values[fromIdx];
    const b = row.values[toIdx];
    if (typeof a === 'number' && typeof b === 'number') pairs.push([a, b]);
  }
  return pairs;
}

export function elementDistance(
  matrix: GridMatrix,
  fromElement: string,
  toElement: string,
): ElementDistance | null {
  const fromIdx = columnIndex(matrix, fromElement);
  const toIdx = columnIndex(matrix, toElement);
  if (fromIdx < 0 || toIdx < 0) return null;
  const pairs = pairedValues(matrix, fromIdx, toIdx);
  if (pairs.length === 0) return null;

  const manhattan = pairs.reduce((acc, [a, b]) => acc + Math.abs(a - b), 0);
  const euclidean = Math.sqrt(pairs.reduce((acc, [a, b]) => acc + (a - b) ** 2, 0));
  const maxManhattan = pairs.length * SCALE_RANGE;
  const maxEuclidean = Math.sqrt(pairs.length * SCALE_RANGE ** 2);

  return {
    fromElement,
    toElement,
    manhattan: round3(manhattan),
    manhattanNormalized: round3(manhattan / maxManhattan),
    euclidean: round3(euclidean),
    euclideanNormalized: round3(euclidean / maxEuclidean),
    comparedConstructs: pairs.length,
  };
}

/** Коэффициент Пирсона; null при нулевой дисперсии одной из строк. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xs = a.slice(0, n);
  const ys = b.slice(0, n);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = (xs[i] as number) - mx;
    const vy = (ys[i] as number) - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return round3(num / Math.sqrt(dx * dy));
}

/** Косинус по центрированным векторам — устойчив к сдвигу шкалы. */
export function centeredCosine(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xs = a.slice(0, n);
  const ys = b.slice(0, n);
  const mx = mean(xs);
  const my = mean(ys);
  const cx = xs.map((v) => v - mx);
  const cy = ys.map((v) => v - my);
  const dot = cx.reduce((acc, v, i) => acc + v * (cy[i] as number), 0);
  const nx = Math.sqrt(cx.reduce((acc, v) => acc + v * v, 0));
  const ny = Math.sqrt(cy.reduce((acc, v) => acc + v * v, 0));
  if (nx === 0 || ny === 0) return null;
  return round3(dot / (nx * ny));
}

const DUPLICATE_CORRELATION = 0.8;
const CLUSTER_CUTOFF = 0.35; // d = 1 − |r|

/** Полные ряды (без пропусков) нужны для корреляций между конструктами. */
function completeRows(matrix: GridMatrix): Array<{ id: string; values: number[] }> {
  return matrix.rows
    .filter((r) => r.values.every((v): v is number => typeof v === 'number'))
    .map((r) => ({ id: r.constructId, values: r.values as number[] }));
}

export function constructSimilarities(matrix: GridMatrix): ConstructPairSimilarity[] {
  const rows = completeRows(matrix);
  const result: ConstructPairSimilarity[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i] as { id: string; values: number[] };
      const b = rows[j] as { id: string; values: number[] };
      const r = pearson(a.values, b.values);
      const cos = centeredCosine(a.values, b.values);
      result.push({
        constructAId: a.id,
        constructBId: b.id,
        correlation: r,
        cosine: cos,
        inverted: r !== null && r < 0,
        potentialDuplicate: r !== null && Math.abs(r) >= DUPLICATE_CORRELATION,
      });
    }
  }
  return result;
}

/**
 * Агломеративная кластеризация конструктов, average linkage, d = 1 − |r|,
 * отсечка 0.35 (docs/KELLY_METHOD.md §7).
 */
export function clusterConstructs(
  matrix: GridMatrix,
  similarities: ConstructPairSimilarity[],
): ConstructCluster[] {
  const rows = completeRows(matrix);
  if (rows.length < 2) return [];

  const distance = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const sim of similarities) {
    const d = sim.correlation === null ? 1 : 1 - Math.abs(sim.correlation);
    distance.set(key(sim.constructAId, sim.constructBId), d);
  }

  let clusters: string[][] = rows.map((r) => [r.id]);

  const linkage = (x: string[], y: string[]): number => {
    const values: number[] = [];
    for (const a of x) for (const b of y) values.push(distance.get(key(a, b)) ?? 1);
    return mean(values);
  };

  for (;;) {
    let bestPair: [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const d = linkage(clusters[i] as string[], clusters[j] as string[]);
        if (d < bestDistance) {
          bestDistance = d;
          bestPair = [i, j];
        }
      }
    }
    if (!bestPair || bestDistance > CLUSTER_CUTOFF) break;
    const [i, j] = bestPair;
    const merged = [...(clusters[i] as string[]), ...(clusters[j] as string[])];
    clusters = clusters.filter((_, idx) => idx !== i && idx !== j);
    clusters.push(merged);
  }

  return clusters
    .filter((c) => c.length > 1)
    .map((members) => {
      const values: number[] = [];
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const d = distance.get(key(members[i] as string, members[j] as string)) ?? 1;
          values.push(1 - d);
        }
      }
      return { members: [...members].sort(), averageAbsCorrelation: round3(mean(values)) };
    })
    .sort((a, b) => b.averageAbsCorrelation - a.averageAbsCorrelation);
}

/**
 * Сигнал профессиональной рефлексии (docs/SCORING.md §11).
 * И нулевой, и максимальный разрыв «Я»↔«Идеал» снижают сигнал; целевая
 * зона — умеренный осознаваемый разрыв около 0.35.
 */
export function reflectionSignal(selfIdealGap: number): number {
  return round3(clamp01(1 - Math.abs(selfIdealGap - 0.35) / 0.65));
}

export function computeGridMetrics(matrix: GridMatrix): GridMetrics {
  const totalCells = matrix.rows.length * matrix.elementCodes.length;
  const allValues = matrix.rows.flatMap((r) => r.values.filter((v): v is number => typeof v === 'number'));
  const filledCells = allValues.length;

  const distribution: Record<string, number> = {};
  for (let s = SCALE_MIN; s <= SCALE_MAX; s += 1) distribution[String(s)] = 0;
  for (const v of allValues) distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;

  const extremes = allValues.filter((v) => v === SCALE_MIN || v === SCALE_MAX).length;
  const midpoints = allValues.filter((v) => v === 4).length;

  const selfToIdeal = elementDistance(matrix, matrix.selfElementCode, matrix.idealElementCode);
  const selfToBest = matrix.bestElementCode
    ? elementDistance(matrix, matrix.selfElementCode, matrix.bestElementCode)
    : null;
  const selfToWeak = matrix.weakElementCode
    ? elementDistance(matrix, matrix.selfElementCode, matrix.weakElementCode)
    : null;

  const all: ElementDistance[] = [];
  for (let i = 0; i < matrix.elementCodes.length; i += 1) {
    for (let j = i + 1; j < matrix.elementCodes.length; j += 1) {
      const d = elementDistance(
        matrix,
        matrix.elementCodes[i] as string,
        matrix.elementCodes[j] as string,
      );
      if (d) all.push(d);
    }
  }

  const similarity = constructSimilarities(matrix);
  const clusters = clusterConstructs(matrix, similarity);
  const potentialDuplicatePairs = similarity.filter((s) => s.potentialDuplicate);

  // Противоречивость: сильно связанные пары, по-разному оценивающие «Идеал».
  const idealIdx = columnIndex(matrix, matrix.idealElementCode);
  const rowById = new Map(matrix.rows.map((r) => [r.constructId, r]));
  let inconsistent = 0;
  for (const pair of potentialDuplicatePairs) {
    const a = rowById.get(pair.constructAId);
    const b = rowById.get(pair.constructBId);
    if (!a || !b || idealIdx < 0) continue;
    const va = a.values[idealIdx];
    const vb = b.values[idealIdx];
    if (typeof va !== 'number' || typeof vb !== 'number') continue;
    const sameSide = (va < 4 && vb < 4) || (va > 4 && vb > 4) || (va === 4 && vb === 4);
    // Обратная связь конструктов ожидает противоположных оценок идеала.
    if (pair.inverted ? sameSide : !sameSide) inconsistent += 1;
  }

  const selfIdx = columnIndex(matrix, matrix.selfElementCode);
  const constructSignificance = matrix.rows.map((row) => {
    const values = row.values.filter((v): v is number => typeof v === 'number');
    const m = mean(values);
    const sd =
      values.length < 2
        ? 0
        : Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
    const discriminationPower = round3(clamp01(sd / 3));
    const selfValue = selfIdx >= 0 ? row.values[selfIdx] : null;
    const idealValue = idealIdx >= 0 ? row.values[idealIdx] : null;
    const selfIdealDistance =
      typeof selfValue === 'number' && typeof idealValue === 'number'
        ? round3(Math.abs(selfValue - idealValue) / SCALE_RANGE)
        : 0;
    return {
      constructId: row.constructId,
      discriminationPower,
      selfIdealDistance,
      significance: round3(0.5 * discriminationPower + 0.3 * selfIdealDistance),
    };
  });

  const selfIdealGap = selfToIdeal ? selfToIdeal.manhattanNormalized : null;

  return {
    engineVersion: GRID_ENGINE_VERSION,
    disclaimer: GRID_DISCLAIMER,
    constructCount: matrix.rows.length,
    elementCount: matrix.elementCodes.length,
    filledCells,
    totalCells,
    distances: { selfToIdeal, selfToBest, selfToWeak, all },
    constructSimilarity: similarity,
    clusters,
    potentialDuplicatePairs,
    polarization: filledCells ? round3(extremes / filledCells) : 0,
    extremeShare: filledCells ? round3(extremes / filledCells) : 0,
    midpointShare: filledCells ? round3(midpoints / filledCells) : 0,
    distribution,
    inconsistencyShare: potentialDuplicatePairs.length
      ? round3(inconsistent / potentialDuplicatePairs.length)
      : 0,
    selfIdealGap,
    reflectionSignal: selfIdealGap === null ? null : reflectionSignal(selfIdealGap),
    constructSignificance,
  };
}
