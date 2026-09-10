import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  findPotentialDuplicate,
  type ConstructTextSnapshot,
} from '../kelly/similarity.js';
import {
  GRID_ENGINE_VERSION,
  computeGridMetrics,
  type GridMatrix,
  type GridMetrics,
} from '../kelly/grid.js';
import {
  MAX_LADDER_DEPTH,
  MIN_LADDER_DEPTH,
  classifyLadderTerminal,
  nextLadderStep,
  selectFromGridMetrics,
} from '../kelly/laddering.js';
import type { AnswerValue } from '../validation/answers.js';

/**
 * Kelly Engine: конструкты, детекция дублей, решётка, лестница смыслов.
 * Математика находится в src/server/kelly/** (чистые функции).
 */

export interface CreateConstructResult {
  constructId: string;
  similarityCheck: { id: string; otherConstructId: string; score: number } | null;
}

/**
 * Создание персонального конструкта из ответа на триаду.
 * При обнаружении смысловой близости создаётся ПРОВЕРКА, а не слияние:
 * объединять конструкты без подтверждения кандидата запрещено (§5).
 */
export async function createConstructFromTriad(
  sessionId: string,
  value: Extract<AnswerValue, { kind: 'KELLY_TRIAD' }>,
): Promise<CreateConstructResult> {
  const session = await prisma.testSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { assessmentVersionId: true, version: { select: { similarityThreshold: true } } },
  });

  const triad = await prisma.kellyTriad.findUnique({
    where: { id: value.triadId },
    select: { id: true, assessmentVersionId: true },
  });
  if (!triad) throw notFound('Триада не найдена');
  if (triad.assessmentVersionId !== session.assessmentVersionId) {
    throw badRequest('Триада не принадлежит версии ассессмента этой сессии');
  }

  const existing = await prisma.candidateConstruct.findMany({
    where: { sessionId, isDuplicateOf: null },
    orderBy: { orderIndex: 'asc' },
  });

  const constructData = {
    sessionId,
    triadId: triad.id,
    poleLeft: value.poleLeft.trim(),
    poleRight: value.poleRight.trim(),
    similarPairElements: value.similarPair as unknown as Prisma.InputJsonValue,
    similarityExplanation: value.similarity,
    differenceExplanation: value.difference,
    importanceReason: value.importanceReason,
    rigManifestation: value.rigManifestation,
    experienceExample: value.experienceExample,
    orderIndex: existing.length,
  };

  const previous = await prisma.candidateConstruct.findFirst({
    where: { sessionId, triadId: triad.id },
  });

  const construct = previous
    ? await prisma.candidateConstruct.update({ where: { id: previous.id }, data: constructData })
    : await prisma.candidateConstruct.create({ data: constructData });

  const snapshot: ConstructTextSnapshot = {
    id: construct.id,
    poleLeft: construct.poleLeft,
    poleRight: construct.poleRight,
    importanceReason: construct.importanceReason,
    rigManifestation: construct.rigManifestation,
  };

  const threshold = Number(session.version.similarityThreshold) || DEFAULT_SIMILARITY_THRESHOLD;
  const duplicate = findPotentialDuplicate(
    snapshot,
    existing.map((c) => ({
      id: c.id,
      poleLeft: c.poleLeft,
      poleRight: c.poleRight,
      importanceReason: c.importanceReason,
      rigManifestation: c.rigManifestation,
    })),
    threshold,
  );

  if (!duplicate) return { constructId: construct.id, similarityCheck: null };

  // Пара нормализуется, чтобы одна и та же проверка не создавалась дважды.
  const [aId, bId] =
    construct.id < duplicate.otherConstructId
      ? [construct.id, duplicate.otherConstructId]
      : [duplicate.otherConstructId, construct.id];

  const check = await prisma.constructSimilarityCheck.upsert({
    where: { constructAId_constructBId: { constructAId: aId, constructBId: bId } },
    update: { lexicalScore: duplicate.lexicalScore },
    create: { constructAId: aId, constructBId: bId, lexicalScore: duplicate.lexicalScore },
  });

  return {
    constructId: construct.id,
    similarityCheck:
      check.candidateVerdict === 'PENDING'
        ? { id: check.id, otherConstructId: duplicate.otherConstructId, score: duplicate.lexicalScore }
        : null,
  };
}

/**
 * Ответ кандидата на вопрос о дублировании. Только этот путь может пометить
 * конструкт дубликатом — автоматического слияния в системе нет.
 */
export async function answerSimilarityCheck(
  sessionId: string,
  checkId: string,
  verdict: 'SAME' | 'DIFFERENT',
  explanation: string | null,
): Promise<void> {
  const check = await prisma.constructSimilarityCheck.findUnique({
    where: { id: checkId },
    include: {
      constructA: { select: { id: true, sessionId: true, orderIndex: true } },
      constructB: { select: { id: true, sessionId: true, orderIndex: true } },
    },
  });
  if (!check) throw notFound('Проверка конструктов не найдена');
  if (check.constructA.sessionId !== sessionId || check.constructB.sessionId !== sessionId) {
    throw conflict('Проверка относится к другой сессии');
  }

  if (verdict === 'DIFFERENT' && (explanation ?? '').trim().length < 20) {
    throw badRequest('Укажите, в чём именно состоит различие между критериями (не менее 20 символов)');
  }

  await prisma.constructSimilarityCheck.update({
    where: { id: checkId },
    data: {
      candidateVerdict: verdict,
      candidateExplanation: explanation,
      answeredAt: new Date(),
    },
  });

  if (verdict === 'SAME') {
    // Дубликатом помечается более поздний конструкт; ранний сохраняется.
    const later =
      check.constructA.orderIndex >= check.constructB.orderIndex ? check.constructA : check.constructB;
    const earlier = later.id === check.constructA.id ? check.constructB : check.constructA;
    await prisma.candidateConstruct.update({
      where: { id: later.id },
      data: { isDuplicateOf: earlier.id },
    });
  }
}

export async function saveGridRating(
  sessionId: string,
  constructId: string,
  elementId: string,
  rating: number,
): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 7) {
    throw badRequest('Оценка по шкале допускается от 1 до 7');
  }
  const construct = await prisma.candidateConstruct.findUnique({
    where: { id: constructId },
    select: { sessionId: true, isDuplicateOf: true },
  });
  if (!construct || construct.sessionId !== sessionId) throw notFound('Конструкт не найден');
  if (construct.isDuplicateOf) throw conflict('Конструкт помечен как дублирующий и не оценивается');

  await prisma.constructRating.upsert({
    where: { constructId_elementId: { constructId, elementId } },
    update: { rating },
    create: { constructId, elementId, rating },
  });
}

/** Решётка считается заполненной, когда оценены все клетки. */
export async function isGridComplete(sessionId: string): Promise<boolean> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { assessmentVersionId: true },
  });
  if (!session) return false;

  const [constructCount, elementCount, ratingCount] = await Promise.all([
    prisma.candidateConstruct.count({ where: { sessionId, isDuplicateOf: null } }),
    prisma.kellyElement.count({ where: { assessmentVersionId: session.assessmentVersionId } }),
    prisma.constructRating.count({ where: { construct: { sessionId, isDuplicateOf: null } } }),
  ]);

  if (constructCount === 0 || elementCount === 0) return false;
  return ratingCount >= constructCount * elementCount;
}

/** Построение матрицы решётки для математики (docs/KELLY_METHOD.md §7). */
export async function buildGridMatrix(sessionId: string): Promise<GridMatrix | null> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { assessmentVersionId: true },
  });
  if (!session) return null;

  const [constructs, elements, ratings] = await Promise.all([
    prisma.candidateConstruct.findMany({
      where: { sessionId, isDuplicateOf: null },
      select: { id: true, poleLeft: true, poleRight: true },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.kellyElement.findMany({
      where: { assessmentVersionId: session.assessmentVersionId },
      select: { id: true, code: true, isSelf: true, isIdeal: true },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.constructRating.findMany({
      where: { construct: { sessionId, isDuplicateOf: null } },
      select: { constructId: true, elementId: true, rating: true },
    }),
  ]);

  if (constructs.length === 0 || elements.length === 0) return null;

  const byCell = new Map<string, number>();
  for (const r of ratings) byCell.set(`${r.constructId}:${r.elementId}`, r.rating);

  const self = elements.find((e) => e.isSelf);
  const ideal = elements.find((e) => e.isIdeal);
  if (!self || !ideal) return null;

  return {
    elementCodes: elements.map((e) => e.code),
    selfElementCode: self.code,
    idealElementCode: ideal.code,
    // E1 — «один из лучших», E8 — «не оставил бы самостоятельно» (§21).
    bestElementCode: elements.find((e) => e.code === 'E1')?.code,
    weakElementCode: elements.find((e) => e.code === 'E8')?.code,
    rows: constructs.map((c) => ({
      constructId: c.id,
      poleLeft: c.poleLeft,
      poleRight: c.poleRight,
      values: elements.map((e) => byCell.get(`${c.id}:${e.id}`) ?? null),
    })),
  };
}

/**
 * Расчёт и сохранение метрик решётки. Пересчёт новой версией движка создаёт
 * НОВУЮ запись GridAnalysis, а не переписывает старую (§32).
 */
export async function computeAndStoreGridMetrics(sessionId: string): Promise<GridMetrics | null> {
  const matrix = await buildGridMatrix(sessionId);
  if (!matrix) return null;
  const metrics = computeGridMetrics(matrix);

  const existing = await prisma.gridAnalysis.findFirst({
    where: { sessionId, engineVersion: GRID_ENGINE_VERSION },
    orderBy: { computedAt: 'desc' },
  });

  if (existing) {
    await prisma.gridAnalysis.update({
      where: { id: existing.id },
      data: { metrics: metrics as unknown as Prisma.InputJsonValue, computedAt: new Date() },
    });
  } else {
    await prisma.gridAnalysis.create({
      data: {
        sessionId,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        engineVersion: GRID_ENGINE_VERSION,
      },
    });
  }

  // Ранг значимости конструкта используется для отбора в лестницу и для
  // проверки согласованности деклараций (§22).
  const ranked = [...metrics.constructSignificance].sort((a, b) => b.significance - a.significance);
  for (const [index, item] of ranked.entries()) {
    await prisma.candidateConstruct.update({
      where: { id: item.constructId },
      data: { importanceRank: index + 1 },
    });
  }

  return metrics;
}

export async function latestGridMetrics(sessionId: string): Promise<GridMetrics | null> {
  const record = await prisma.gridAnalysis.findFirst({
    where: { sessionId },
    orderBy: { computedAt: 'desc' },
  });
  return (record?.metrics as unknown as GridMetrics) ?? null;
}

/** Конструкты для лестницы смыслов, отобранные по значимости (§7). */
export async function selectLadderTargets(sessionId: string, count: number): Promise<string[]> {
  let metrics = await latestGridMetrics(sessionId);
  if (!metrics) metrics = await computeAndStoreGridMetrics(sessionId);
  if (!metrics) return [];

  const constructs = await prisma.candidateConstruct.findMany({
    where: { sessionId, isDuplicateOf: null },
    select: { id: true, importanceRank: true },
  });
  const ranks = new Map(constructs.map((c) => [c.id, c.importanceRank]));

  return selectFromGridMetrics(metrics, ranks, count).map((s) => s.constructId);
}

export interface LadderProgress {
  depths: Map<string, number>;
  completed: Set<string>;
}

export async function ladderProgress(sessionId: string): Promise<LadderProgress> {
  const steps = await prisma.ladderStep.findMany({
    where: { construct: { sessionId } },
    select: { constructId: true, depth: true, answer: true },
    orderBy: { depth: 'asc' },
  });

  const grouped = new Map<string, Array<{ depth: number; answer: string }>>();
  for (const step of steps) {
    const bucket = grouped.get(step.constructId);
    if (bucket) bucket.push({ depth: step.depth, answer: step.answer });
    else grouped.set(step.constructId, [{ depth: step.depth, answer: step.answer }]);
  }

  const depths = new Map<string, number>();
  const completed = new Set<string>();
  for (const [constructId, items] of grouped) {
    depths.set(constructId, items.length);
    if (!nextLadderStep(items).shouldContinue) completed.add(constructId);
  }
  return { depths, completed };
}

/**
 * Сохранение шага лестницы. Глубина ограничена жёстко: значение выше
 * MAX_LADDER_DEPTH отклоняется сервером.
 */
export async function saveLadderStep(
  sessionId: string,
  constructId: string,
  depth: number,
  answer: string,
): Promise<{ terminalTag: string | null; completed: boolean }> {
  if (depth < 1 || depth > MAX_LADDER_DEPTH) {
    throw badRequest(`Глубина лестницы смыслов допускается от 1 до ${MAX_LADDER_DEPTH}`);
  }
  const construct = await prisma.candidateConstruct.findUnique({
    where: { id: constructId },
    select: { sessionId: true },
  });
  if (!construct || construct.sessionId !== sessionId) throw notFound('Конструкт не найден');

  const existing = await prisma.ladderStep.findMany({
    where: { constructId },
    orderBy: { depth: 'asc' },
    select: { depth: true, answer: true },
  });
  if (existing.length >= MAX_LADDER_DEPTH) {
    throw conflict('Достигнута максимальная глубина лестницы смыслов');
  }

  const answers = [...existing.map((s) => s.answer), answer];
  const terminalTag = classifyLadderTerminal(answers);

  await prisma.ladderStep.upsert({
    where: { constructId_depth: { constructId, depth } },
    update: { answer, terminalTag },
    create: {
      constructId,
      depth,
      question: 'Почему для вас это важно?',
      answer,
      terminalTag,
    },
  });

  const continuation = nextLadderStep(
    answers.map((a, i) => ({ depth: i + 1, answer: a })),
  );

  return { terminalTag, completed: !continuation.shouldContinue };
}

export { MAX_LADDER_DEPTH, MIN_LADDER_DEPTH };

/** Конструкты сессии для отчёта и drill-down. */
export async function listConstructs(sessionId: string) {
  return prisma.candidateConstruct.findMany({
    where: { sessionId },
    include: {
      triad: { select: { code: true } },
      ratings: { include: { element: { select: { code: true, label: true } } } },
      ladderSteps: { orderBy: { depth: 'asc' } },
      checksAsA: { select: { candidateVerdict: true, candidateExplanation: true, lexicalScore: true } },
      checksAsB: { select: { candidateVerdict: true, candidateExplanation: true, lexicalScore: true } },
    },
    orderBy: { orderIndex: 'asc' },
  });
}
