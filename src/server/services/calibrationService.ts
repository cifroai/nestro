import { prisma } from '../db/prisma.js';
import { round3 } from '../scoring/round.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';

/**
 * Калибровка (§31): сопоставление модельных и экспертных оценок.
 *
 * ВАЖНО: система не меняет веса автоматически. Она формулирует наблюдения
 * вида «данный критерий имеет слабую/сильную наблюдаемую связь»; решение об
 * изменении модели оценки принимает администратор.
 */

export interface CalibrationQuery {
  positionCode?: string;
  from?: Date;
  to?: Date;
}

export interface CalibrationPoint {
  competencyCode: string;
  modelScore: number;
  humanScore: number;
  answerId: string;
  reviewerName: string;
  createdAt: Date;
}

export interface CalibrationMetrics {
  sampleSize: number;
  /** Средняя абсолютная ошибка модели относительно экспертной оценки. */
  mae: number | null;
  /** Систематическое смещение: положительное — модель завышает. */
  bias: number | null;
  /** Распределение расхождений по величине. */
  deltaDistribution: Array<{ bucket: string; count: number }>;
  /** Доля корректировок, изменивших балл на 1 и более. */
  significantOverrideShare: number;
  byCompetency: Array<{
    competencyCode: string;
    competencyTitle: string;
    sampleSize: number;
    mae: number | null;
    bias: number | null;
    overrideRate: number;
    observation: string;
  }>;
  reviewerConsistency: Array<{
    reviewerName: string;
    reviews: number;
    averageDelta: number | null;
    /** Сравнение со средним смещением остальных экспертов. */
    deviationFromPeers: number | null;
  }>;
  points: CalibrationPoint[];
  notes: string[];
}

const DELTA_BUCKETS: Array<[string, number, number]> = [
  ['0', 0, 0.249],
  ['0,25–0,5', 0.25, 0.5],
  ['0,5–1', 0.501, 1],
  ['1–2', 1.001, 2],
  ['более 2', 2.001, 4],
];

export async function calibrationMetrics(query: CalibrationQuery): Promise<CalibrationMetrics> {
  const sessionWhere = {
    ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const reviews = await prisma.humanReview.findMany({
    where: {
      answer: { session: sessionWhere },
      markedUninformative: false,
      humanScore: { not: null },
      modelScore: { not: null },
    },
    include: {
      competency: { select: { code: true, title: true } },
      reviewer: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const points: CalibrationPoint[] = reviews
    .filter((r) => r.answerId !== null)
    .map((r) => ({
      competencyCode: r.competency.code,
      modelScore: Number(r.modelScore),
      humanScore: Number(r.humanScore),
      answerId: r.answerId as string,
      reviewerName: r.reviewer.fullName,
      createdAt: r.createdAt,
    }));

  const deltas = points.map((p) => p.modelScore - p.humanScore);
  const absDeltas = deltas.map(Math.abs);

  const totalDimensions = await prisma.lLMDimensionScore.count({
    where: { llmAssessment: { answer: { session: sessionWhere } } },
  });

  const byCompetencyMap = new Map<string, { title: string; deltas: number[]; overrides: number }>();
  for (const point of points) {
    const entry = byCompetencyMap.get(point.competencyCode) ?? {
      title: reviews.find((r) => r.competency.code === point.competencyCode)?.competency.title ?? point.competencyCode,
      deltas: [],
      overrides: 0,
    };
    entry.deltas.push(point.modelScore - point.humanScore);
    if (Math.abs(point.modelScore - point.humanScore) >= 1) entry.overrides += 1;
    byCompetencyMap.set(point.competencyCode, entry);
  }

  const byReviewer = new Map<string, number[]>();
  for (const point of points) {
    const bucket = byReviewer.get(point.reviewerName) ?? [];
    bucket.push(point.modelScore - point.humanScore);
    byReviewer.set(point.reviewerName, bucket);
  }
  const globalBias = deltas.length === 0 ? null : deltas.reduce((a, b) => a + b, 0) / deltas.length;

  return {
    sampleSize: points.length,
    mae: absDeltas.length === 0 ? null : round3(absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length),
    bias: globalBias === null ? null : round3(globalBias),
    deltaDistribution: DELTA_BUCKETS.map(([bucket, min, max]) => ({
      bucket,
      count: absDeltas.filter((d) => d >= min && d <= max).length,
    })),
    significantOverrideShare:
      absDeltas.length === 0 ? 0 : round3(absDeltas.filter((d) => d >= 1).length / absDeltas.length),
    byCompetency: [...byCompetencyMap.entries()]
      .map(([code, entry]) => {
        const mae = round3(entry.deltas.reduce((a, b) => a + Math.abs(b), 0) / entry.deltas.length);
        const bias = round3(entry.deltas.reduce((a, b) => a + b, 0) / entry.deltas.length);
        return {
          competencyCode: code,
          competencyTitle: entry.title,
          sampleSize: entry.deltas.length,
          mae,
          bias,
          overrideRate: round3(entry.overrides / entry.deltas.length),
          observation:
            entry.deltas.length < 10
              ? 'выборка недостаточна для вывода о связи'
              : mae <= 0.4
                ? 'наблюдаемая связь модельной и экспертной оценки сильная'
                : mae <= 0.8
                  ? 'наблюдаемая связь умеренная'
                  : 'наблюдаемая связь слабая: критерий требует методической проверки',
        };
      })
      .sort((a, b) => (b.mae ?? 0) - (a.mae ?? 0)),
    reviewerConsistency: [...byReviewer.entries()].map(([reviewerName, list]) => {
      const average = list.reduce((a, b) => a + b, 0) / list.length;
      return {
        reviewerName,
        reviews: list.length,
        averageDelta: round3(average),
        deviationFromPeers: globalBias === null ? null : round3(average - globalBias),
      };
    }),
    points,
    notes: [
      'Веса и пороги модели оценки не изменяются автоматически. Наблюдения носят методический характер.',
      'Малые выборки (менее 10 сопоставлений по компетенции) не дают основания для выводов о связи.',
      `Всего оценок компетенций в выборке: ${totalDimensions}; из них проверено экспертом: ${points.length}.`,
    ],
  };
}

/** Фиксация прогона калибровки для истории. */
export async function recordCalibrationRun(
  label: string,
  query: CalibrationQuery,
  actor: { userId: string; ip?: string | null; requestId?: string | null },
) {
  const metrics = await calibrationMetrics(query);
  const position = query.positionCode
    ? await prisma.position.findUnique({ where: { code: query.positionCode }, select: { id: true } })
    : null;

  const run = await prisma.calibrationRun.create({
    data: {
      label,
      positionId: position?.id ?? null,
      fromDate: query.from ?? null,
      toDate: query.to ?? null,
      sampleSize: metrics.sampleSize,
      metrics: {
        create: [
          ...(metrics.mae !== null
            ? [{ metric: 'MAE', value: metrics.mae, sampleSize: metrics.sampleSize }]
            : []),
          ...(metrics.bias !== null
            ? [{ metric: 'BIAS', value: metrics.bias, sampleSize: metrics.sampleSize }]
            : []),
          ...metrics.byCompetency.map((c) => ({
            competencyCode: c.competencyCode,
            metric: 'MAE',
            value: c.mae ?? 0,
            sampleSize: c.sampleSize,
            observationNote: c.observation,
          })),
        ],
      },
    },
    include: { metrics: true },
  });

  await recordAudit({
    action: 'calibration.run.recorded',
    entity: 'CalibrationRun',
    entityId: run.id,
    actorUserId: actor.userId,
    newValue: { label, sampleSize: metrics.sampleSize, mae: metrics.mae, bias: metrics.bias },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return run;
}

export async function listCalibrationRuns() {
  return prisma.calibrationRun.findMany({
    include: { metrics: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/**
 * Связь результатов теста с последующей профессиональной эффективностью (§31).
 * Возвращает наблюдение, а не решение об изменении модели.
 */
export async function outcomeCorrelation(positionCode?: string) {
  const outcomes = await prisma.employmentOutcome.findMany({
    where: {
      probationScore: { not: null },
      ...(positionCode ? { candidate: { position: { code: positionCode } } } : {}),
    },
    include: {
      candidate: {
        select: {
          id: true,
          sessions: {
            where: { status: 'COMPLETED' },
            select: {
              finalScores: {
                where: { supersededById: null, competencyId: null, axis: null },
                select: { score0to100: true },
              },
            },
            orderBy: { completedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  const pairs: Array<[number, number]> = [];
  for (const outcome of outcomes) {
    const score = outcome.candidate.sessions[0]?.finalScores[0]?.score0to100;
    if (score === null || score === undefined) continue;
    pairs.push([Number(score), Number(outcome.probationScore)]);
  }

  if (pairs.length < 10) {
    return {
      sampleSize: pairs.length,
      correlation: null,
      observation:
        'Выборка недостаточна для вывода о связи результатов оценки с последующей ' +
        'профессиональной эффективностью (требуется не менее 10 наблюдений).',
    };
  }

  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const vx = (xs[i] as number) - mx;
    const vy = (ys[i] as number) - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const correlation = dx === 0 || dy === 0 ? null : round3(num / Math.sqrt(dx * dy));

  return {
    sampleSize: pairs.length,
    correlation,
    observation:
      correlation === null
        ? 'Дисперсия недостаточна для расчёта связи.'
        : correlation >= 0.5
          ? 'Наблюдается заметная положительная связь. Изменение модели оценки выполняет администратор.'
          : correlation >= 0.2
            ? 'Наблюдается слабая положительная связь.'
            : 'Связь не наблюдается; требуется методический анализ содержания оценки.',
  };
}

export { AUDIT_ACTIONS };
