import { prisma } from '../db/prisma.js';
import { round3 } from '../scoring/round.js';
import { queueDepths } from '../queue/queues.js';
import { RISK_FLAG_BY_CODE } from '../scoring/riskFlags.js';

/**
 * Аналитика (§49) и статистика качества вопросов (§50).
 *
 * Автоматические изменения модели оценки запрещены: система только
 * ПОКАЗЫВАЕТ наблюдения, решение об изменении принимает администратор (§31).
 */

export interface AnalyticsQuery {
  positionCode?: string;
  from?: Date;
  to?: Date;
}

export interface AnalyticsSummary {
  invitations: { total: number; byStatus: Record<string, number> };
  sessions: {
    total: number;
    completed: number;
    inProgress: number;
    expired: number;
    completionRate: number;
    averageDurationMinutes: number | null;
    pendingAssessment: number;
    reviewRequired: number;
  };
  scores: {
    averageOverall: number | null;
    medianOverall: number | null;
    distribution: Array<{ band: string; count: number }>;
    histogram: Array<{ bucket: string; count: number }>;
    insufficientData: number;
  };
  competencies: Array<{
    code: string;
    title: string;
    averageScore0to4: number | null;
    averageConfidence: number;
    notEnoughEvidenceShare: number;
    sampleSize: number;
  }>;
  riskFlags: Array<{ code: string; title: string; count: number; share: number }>;
  disagreement: {
    comparedPairs: number;
    averageAbsoluteDelta: number | null;
    exceedingThresholdShare: number;
    humanOverrideRate: number;
  };
  byPosition: Array<{ code: string; title: string; sessions: number; averageOverall: number | null }>;
  queue: Record<string, number>;
  notes: string[];
}

function sessionWhere(query: AnalyticsQuery) {
  return {
    ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
}

const HISTOGRAM_BUCKETS: Array<[string, number, number]> = [
  ['0–19', 0, 19.999],
  ['20–39', 20, 39.999],
  ['40–54', 40, 54.999],
  ['55–69', 55, 69.999],
  ['70–84', 70, 84.999],
  ['85–100', 85, 100],
];

export async function analyticsSummary(query: AnalyticsQuery): Promise<AnalyticsSummary> {
  const where = sessionWhere(query);

  const [invitationGroups, sessions, overallScores, competencyScores, flags, positions] =
    await Promise.all([
      prisma.invitation.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: {
          ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
          ...(query.from || query.to
            ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
            : {}),
        },
      }),
      prisma.testSession.findMany({
        where,
        select: {
          id: true,
          status: true,
          assessmentStatus: true,
          reviewRequired: true,
          startedAt: true,
          completedAt: true,
          candidate: { select: { position: { select: { code: true, title: true } } } },
        },
      }),
      prisma.finalScore.findMany({
        where: { supersededById: null, competencyId: null, axis: null, session: where },
        select: {
          sessionId: true,
          score0to100: true,
          band: true,
          notEnoughEvidence: true,
          confidence: true,
        },
      }),
      prisma.finalScore.findMany({
        where: { supersededById: null, competencyId: { not: null }, session: where },
        select: {
          score0to4: true,
          confidence: true,
          notEnoughEvidence: true,
          competency: { select: { code: true, title: true } },
        },
      }),
      prisma.riskFlag.groupBy({
        by: ['code'],
        _count: { _all: true },
        where: { dismissedAt: null, session: where },
      }),
      prisma.position.findMany({ select: { code: true, title: true } }),
    ]);

  const completed = sessions.filter((s) => s.status === 'COMPLETED');
  const durations = completed
    .filter((s) => s.startedAt && s.completedAt)
    .map((s) => ((s.completedAt as Date).getTime() - (s.startedAt as Date).getTime()) / 60_000);

  const scored = overallScores.filter((s) => s.score0to100 !== null && !s.notEnoughEvidence);
  const values = scored.map((s) => Number(s.score0to100)).sort((a, b) => a - b);
  const median =
    values.length === 0
      ? null
      : values.length % 2 === 1
        ? (values[(values.length - 1) / 2] as number)
        : round3((((values[values.length / 2 - 1] as number) + (values[values.length / 2] as number)) / 2));

  const bandCounts = new Map<string, number>();
  for (const score of overallScores) {
    const band = score.band ?? 'INSUFFICIENT_DATA';
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }

  const histogram = HISTOGRAM_BUCKETS.map(([bucket, min, max]) => ({
    bucket,
    count: values.filter((v) => v >= min && v <= max).length,
  }));

  const byCompetency = new Map<
    string,
    { title: string; scores: number[]; confidences: number[]; nee: number; total: number }
  >();
  for (const score of competencyScores) {
    const code = score.competency?.code ?? '';
    const entry =
      byCompetency.get(code) ?? { title: score.competency?.title ?? code, scores: [], confidences: [], nee: 0, total: 0 };
    entry.total += 1;
    entry.confidences.push(Number(score.confidence));
    if (score.notEnoughEvidence || score.score0to4 === null) entry.nee += 1;
    else entry.scores.push(Number(score.score0to4));
    byCompetency.set(code, entry);
  }

  const disagreement = await evaluatorDisagreement(query);

  const sessionsByPosition = new Map<string, number>();
  for (const session of sessions) {
    const code = session.candidate.position.code;
    sessionsByPosition.set(code, (sessionsByPosition.get(code) ?? 0) + 1);
  }
  const overallBySession = new Map(
    overallScores.map((s) => [s.sessionId, s.score0to100 === null ? null : Number(s.score0to100)]),
  );
  const positionAverages = new Map<string, number[]>();
  for (const session of sessions) {
    const value = overallBySession.get(session.id);
    if (value === null || value === undefined) continue;
    const code = session.candidate.position.code;
    const bucket = positionAverages.get(code) ?? [];
    bucket.push(value);
    positionAverages.set(code, bucket);
  }

  const totalFlagSessions = Math.max(1, completed.length);

  return {
    invitations: {
      total: invitationGroups.reduce((acc, g) => acc + g._count._all, 0),
      byStatus: Object.fromEntries(invitationGroups.map((g) => [g.status, g._count._all])),
    },
    sessions: {
      total: sessions.length,
      completed: completed.length,
      inProgress: sessions.filter((s) => s.status === 'IN_PROGRESS').length,
      expired: sessions.filter((s) => s.status === 'EXPIRED').length,
      completionRate: sessions.length === 0 ? 0 : round3(completed.length / sessions.length),
      averageDurationMinutes:
        durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      pendingAssessment: sessions.filter((s) => s.assessmentStatus === 'PENDING').length,
      reviewRequired: sessions.filter((s) => s.reviewRequired).length,
    },
    scores: {
      averageOverall:
        values.length === 0 ? null : round3(values.reduce((a, b) => a + b, 0) / values.length),
      medianOverall: median,
      distribution: [...bandCounts.entries()].map(([band, count]) => ({ band, count })),
      histogram,
      insufficientData: overallScores.filter((s) => s.notEnoughEvidence).length,
    },
    competencies: [...byCompetency.entries()]
      .map(([code, entry]) => ({
        code,
        title: entry.title,
        averageScore0to4:
          entry.scores.length === 0
            ? null
            : round3(entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length),
        averageConfidence:
          entry.confidences.length === 0
            ? 0
            : round3(entry.confidences.reduce((a, b) => a + b, 0) / entry.confidences.length),
        notEnoughEvidenceShare: entry.total === 0 ? 0 : round3(entry.nee / entry.total),
        sampleSize: entry.total,
      }))
      .sort((a, b) => (a.averageScore0to4 ?? 5) - (b.averageScore0to4 ?? 5)),
    riskFlags: flags
      .map((f) => ({
        code: f.code,
        title: RISK_FLAG_BY_CODE.get(f.code)?.title ?? f.code,
        count: f._count._all,
        share: round3(f._count._all / totalFlagSessions),
      }))
      .sort((a, b) => b.count - a.count),
    disagreement,
    byPosition: positions
      .filter((p) => (sessionsByPosition.get(p.code) ?? 0) > 0)
      .map((p) => {
        const list = positionAverages.get(p.code) ?? [];
        return {
          code: p.code,
          title: p.title,
          sessions: sessionsByPosition.get(p.code) ?? 0,
          averageOverall: list.length === 0 ? null : round3(list.reduce((a, b) => a + b, 0) / list.length),
        };
      }),
    queue: await queueDepths(),
    notes: [
      'Показатели являются наблюдениями. Веса и пороги модели оценки изменяются только администратором.',
      'Слабые компетенции выборки могут отражать как уровень кандидатов, так и качество вопросов — см. статистику качества вопросов.',
    ],
  };
}

export interface DisagreementSummary {
  comparedPairs: number;
  averageAbsoluteDelta: number | null;
  exceedingThresholdShare: number;
  humanOverrideRate: number;
}

/** Расхождение оценщиков A и B и частота экспертных корректировок. */
export async function evaluatorDisagreement(query: AnalyticsQuery): Promise<DisagreementSummary> {
  const where = sessionWhere(query);

  const runs = await prisma.lLMAssessment.findMany({
    where: { status: 'OK', answer: { session: where } },
    select: {
      answerId: true,
      evaluatorRole: true,
      dimensionScores: { select: { competencyId: true, score: true, notEnoughEvidence: true } },
    },
  });

  const byKey = new Map<string, { A?: number | null; B?: number | null }>();
  for (const run of runs) {
    for (const dim of run.dimensionScores) {
      const key = `${run.answerId}:${dim.competencyId}`;
      const entry = byKey.get(key) ?? {};
      const value = dim.notEnoughEvidence || dim.score === null ? null : Number(dim.score);
      if (run.evaluatorRole === 'A') entry.A = value;
      else entry.B = value;
      byKey.set(key, entry);
    }
  }

  const deltas: number[] = [];
  for (const entry of byKey.values()) {
    if (entry.A === undefined || entry.B === undefined) continue;
    if (entry.A === null || entry.B === null) continue;
    deltas.push(Math.abs(entry.A - entry.B));
  }

  const [reviewCount, dimensionCount] = await Promise.all([
    prisma.humanReview.count({ where: { answer: { session: where } } }),
    prisma.lLMDimensionScore.count({ where: { llmAssessment: { answer: { session: where } } } }),
  ]);

  return {
    comparedPairs: deltas.length,
    averageAbsoluteDelta:
      deltas.length === 0 ? null : round3(deltas.reduce((a, b) => a + b, 0) / deltas.length),
    exceedingThresholdShare:
      deltas.length === 0 ? 0 : round3(deltas.filter((d) => d >= 1).length / deltas.length),
    humanOverrideRate: dimensionCount === 0 ? 0 : round3(reviewCount / dimensionCount),
  };
}

export interface QuestionStatItem {
  questionVersionId: string;
  questionCode: string;
  section: string;
  prompt: string;
  completionRate: number | null;
  averageScore: number | null;
  variance: number | null;
  correlationWithTotal: number | null;
  humanOverrideRate: number | null;
  missingDataFrequency: number | null;
  sampleSize: number;
  needsMethodicalReview: boolean;
  reviewReasons: string[];
}

const MIN_SAMPLE_FOR_STATS = 5;
const LOW_DISCRIMINATION_VARIANCE = 0.15;
const HIGH_OVERRIDE_RATE = 0.4;
const HIGH_MISSING_RATE = 0.5;

/**
 * Статистика качества вопросов (§50). Вопросы помечаются как требующие
 * методической проверки, но НИКОГДА не удаляются автоматически.
 */
export async function recomputeQuestionStats(): Promise<{ processed: number; flagged: number }> {
  const questionVersions = await prisma.questionVersion.findMany({
    select: {
      id: true,
      assessmentVersionId: true,
      question: { select: { code: true } },
      competencies: { select: { competencyId: true } },
    },
  });

  let flagged = 0;

  for (const qv of questionVersions) {
    const [sessionCount, answers, dimensionScores, overrides] = await Promise.all([
      prisma.testSession.count({
        where: { assessmentVersionId: qv.assessmentVersionId, status: 'COMPLETED' },
      }),
      prisma.answer.count({ where: { questionVersionId: qv.id, status: 'SUBMITTED' } }),
      prisma.lLMDimensionScore.findMany({
        where: { llmAssessment: { answer: { questionVersionId: qv.id }, status: 'OK' } },
        select: { score: true, notEnoughEvidence: true, competencyId: true, llmAssessment: { select: { answer: { select: { sessionId: true } } } } },
      }),
      prisma.humanReview.count({ where: { answer: { questionVersionId: qv.id } } }),
    ]);

    const scores = dimensionScores
      .filter((d) => !d.notEnoughEvidence && d.score !== null)
      .map((d) => Number(d.score));
    const missing = dimensionScores.filter((d) => d.notEnoughEvidence).length;

    const mean = scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.length < 2 || mean === null
        ? null
        : scores.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (scores.length - 1);

    // Корреляция балла вопроса с итогом соответствующей компетенции.
    let correlation: number | null = null;
    const primaryCompetencyId = qv.competencies[0]?.competencyId;
    if (primaryCompetencyId && scores.length >= MIN_SAMPLE_FOR_STATS) {
      const pairs: Array<[number, number]> = [];
      for (const dim of dimensionScores) {
        if (dim.notEnoughEvidence || dim.score === null) continue;
        if (dim.competencyId !== primaryCompetencyId) continue;
        const sessionId = dim.llmAssessment.answer.sessionId;
        const total = await prisma.finalScore.findFirst({
          where: { sessionId, competencyId: primaryCompetencyId, supersededById: null },
          select: { score0to4: true },
        });
        if (total?.score0to4 === null || total?.score0to4 === undefined) continue;
        pairs.push([Number(dim.score), Number(total.score0to4)]);
      }
      if (pairs.length >= MIN_SAMPLE_FOR_STATS) {
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
        correlation = dx === 0 || dy === 0 ? null : round3(num / Math.sqrt(dx * dy));
      }
    }

    const completionRate = sessionCount === 0 ? null : round3(Math.min(1, answers / sessionCount));
    const overrideRate = dimensionScores.length === 0 ? null : round3(overrides / dimensionScores.length);
    const missingRate = dimensionScores.length === 0 ? null : round3(missing / dimensionScores.length);

    const reasons: string[] = [];
    if (answers >= MIN_SAMPLE_FOR_STATS) {
      if (variance !== null && variance < LOW_DISCRIMINATION_VARIANCE) {
        reasons.push('низкая различающая способность: ответы получают почти одинаковые баллы');
      }
      if (overrideRate !== null && overrideRate > HIGH_OVERRIDE_RATE) {
        reasons.push('высокая частота экспертных корректировок');
      }
      if (missingRate !== null && missingRate > HIGH_MISSING_RATE) {
        reasons.push('часто не удаётся найти доказательства в ответах');
      }
      if (correlation !== null && correlation < 0.1) {
        reasons.push('слабая связь с итогом компетенции');
      }
    }

    const needsReview = reasons.length > 0;
    if (needsReview) flagged += 1;

    const existing = await prisma.questionStat.findFirst({
      where: { questionVersionId: qv.id },
      orderBy: { computedAt: 'desc' },
    });

    const data = {
      completionRate,
      averageScore: mean === null ? null : round3(mean),
      variance: variance === null ? null : round3(variance),
      correlationWithTotal: correlation,
      humanOverrideRate: overrideRate,
      missingDataFrequency: missingRate,
      sampleSize: answers,
      needsMethodicalReview: needsReview,
      computedAt: new Date(),
    };

    if (existing) {
      await prisma.questionStat.update({ where: { id: existing.id }, data });
    } else {
      await prisma.questionStat.create({ data: { questionVersionId: qv.id, ...data } });
    }
  }

  return { processed: questionVersions.length, flagged };
}

export async function questionStats(positionCode?: string): Promise<QuestionStatItem[]> {
  const stats = await prisma.questionStat.findMany({
    where: positionCode
      ? { questionVersion: { version: { assessment: { position: { code: positionCode } } } } }
      : {},
    include: {
      questionVersion: {
        select: { id: true, section: true, prompt: true, question: { select: { code: true } } },
      },
    },
    orderBy: { computedAt: 'desc' },
  });

  const seen = new Set<string>();
  const items: QuestionStatItem[] = [];
  for (const stat of stats) {
    if (seen.has(stat.questionVersionId)) continue;
    seen.add(stat.questionVersionId);
    const reasons: string[] = [];
    if (stat.needsMethodicalReview) {
      if (stat.variance !== null && Number(stat.variance) < LOW_DISCRIMINATION_VARIANCE) {
        reasons.push('низкая различающая способность');
      }
      if (stat.humanOverrideRate !== null && Number(stat.humanOverrideRate) > HIGH_OVERRIDE_RATE) {
        reasons.push('высокая частота корректировок эксперта');
      }
      if (stat.missingDataFrequency !== null && Number(stat.missingDataFrequency) > HIGH_MISSING_RATE) {
        reasons.push('часто отсутствуют доказательства');
      }
      if (stat.correlationWithTotal !== null && Number(stat.correlationWithTotal) < 0.1) {
        reasons.push('слабая связь с итогом компетенции');
      }
    }
    items.push({
      questionVersionId: stat.questionVersionId,
      questionCode: stat.questionVersion.question.code,
      section: stat.questionVersion.section,
      prompt: stat.questionVersion.prompt.slice(0, 300),
      completionRate: stat.completionRate === null ? null : Number(stat.completionRate),
      averageScore: stat.averageScore === null ? null : Number(stat.averageScore),
      variance: stat.variance === null ? null : Number(stat.variance),
      correlationWithTotal: stat.correlationWithTotal === null ? null : Number(stat.correlationWithTotal),
      humanOverrideRate: stat.humanOverrideRate === null ? null : Number(stat.humanOverrideRate),
      missingDataFrequency: stat.missingDataFrequency === null ? null : Number(stat.missingDataFrequency),
      sampleSize: stat.sampleSize,
      needsMethodicalReview: stat.needsMethodicalReview,
      reviewReasons: reasons,
    });
  }
  return items;
}
