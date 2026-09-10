import { type Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { badRequest, notFound } from '../http/errors.js';
import { BAND_TITLES, LEVEL_TITLES, confidenceLabel } from '../scoring/engine.js';
import type { BandCode } from '../scoring/types.js';
import { round3 } from '../scoring/round.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';

/**
 * Список кандидатов, карточка и сравнение (§26, §27, §47).
 *
 * Сравнение НЕ формирует автоматический рейтинг по Overall Score:
 * выводятся профили по компетенциям, уверенность, риски и конструкты.
 */

export interface CandidateListQuery {
  positionCode?: string;
  status?: string;
  band?: BandCode;
  minScore?: number;
  maxScore?: number;
  competencyCode?: string;
  minCompetencyScore?: number;
  riskFlagCode?: string;
  reviewRequired?: boolean;
  minConfidence?: number;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: 'completedAt' | 'score' | 'fullName' | 'confidence';
  order?: 'asc' | 'desc';
}

export interface CandidateListItem {
  candidateId: string;
  sessionId: string | null;
  fullName: string;
  positionTitle: string;
  positionCode: string;
  status: string;
  assessmentStatus: string;
  completedAt: Date | null;
  overall: number | null;
  band: BandCode | null;
  bandTitle: string | null;
  confidence: number | null;
  confidenceLabel: string | null;
  coverage: number | null;
  keyCompetencies: Array<{ code: string; title: string; score0to4: number | null; level: number | null }>;
  riskFlagCount: number;
  criticalRiskFlagCount: number;
  reviewRequired: boolean;
  reviewCompletedAt: Date | null;
  anonymized: boolean;
}

export async function listCandidates(query: CandidateListQuery): Promise<{
  items: CandidateListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

  const sessionWhere: Prisma.TestSessionWhereInput = {
    ...(query.positionCode ? { candidate: { position: { code: query.positionCode } } } : {}),
    ...(query.status ? { status: query.status as Prisma.EnumSessionStatusFilter['equals'] } : {}),
    ...(query.reviewRequired !== undefined ? { reviewRequired: query.reviewRequired } : {}),
    ...(query.from || query.to
      ? {
          completedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          candidate: {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
            ...(query.positionCode ? { position: { code: query.positionCode } } : {}),
          },
        }
      : {}),
    ...(query.riskFlagCode ? { riskFlags: { some: { code: query.riskFlagCode, dismissedAt: null } } } : {}),
    ...(query.band || query.minScore !== undefined || query.maxScore !== undefined || query.minConfidence !== undefined
      ? {
          finalScores: {
            some: {
              supersededAt: null,
              competencyId: null,
              axis: null,
              ...(query.band ? { band: query.band } : {}),
              ...(query.minScore !== undefined || query.maxScore !== undefined
                ? {
                    score0to100: {
                      ...(query.minScore !== undefined ? { gte: query.minScore } : {}),
                      ...(query.maxScore !== undefined ? { lte: query.maxScore } : {}),
                    },
                  }
                : {}),
              ...(query.minConfidence !== undefined ? { confidence: { gte: query.minConfidence } } : {}),
            },
          },
        }
      : {}),
    ...(query.competencyCode
      ? {
          finalScores: {
            some: {
              supersededAt: null,
              competency: { code: query.competencyCode },
              ...(query.minCompetencyScore !== undefined
                ? { score0to4: { gte: query.minCompetencyScore } }
                : {}),
            },
          },
        }
      : {}),
  };

  const [sessions, total] = await Promise.all([
    prisma.testSession.findMany({
      where: sessionWhere,
      include: {
        candidate: { include: { position: { select: { code: true, title: true } } } },
        finalScores: {
          where: { supersededAt: null },
          include: { competency: { select: { code: true, title: true } } },
        },
        riskFlags: { where: { dismissedAt: null }, select: { severity: true } },
      },
      orderBy:
        query.sort === 'fullName'
          ? { candidate: { fullName: query.order ?? 'asc' } }
          : { completedAt: query.order ?? 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.testSession.count({ where: sessionWhere }),
  ]);

  const items: CandidateListItem[] = sessions.map((session) => {
    const overall = session.finalScores.find((s) => !s.competencyId && !s.axis);
    const competencies = session.finalScores
      .filter((s) => s.competencyId)
      .sort((a, b) => Number(b.score0to4 ?? 0) - Number(a.score0to4 ?? 0));
    return {
      candidateId: session.candidateId,
      sessionId: session.id,
      fullName: session.candidate.fullName,
      positionTitle: session.candidate.position.title,
      positionCode: session.candidate.position.code,
      status: session.status,
      assessmentStatus: session.assessmentStatus,
      completedAt: session.completedAt,
      overall: overall?.score0to100 === null || overall?.score0to100 === undefined ? null : Number(overall.score0to100),
      band: (overall?.band as BandCode | null) ?? null,
      bandTitle: overall?.band ? BAND_TITLES[overall.band as BandCode] : null,
      confidence: overall ? Number(overall.confidence) : null,
      confidenceLabel: overall ? confidenceLabel(Number(overall.confidence)) : null,
      coverage: overall?.coverage === null || overall?.coverage === undefined ? null : Number(overall.coverage),
      keyCompetencies: competencies.slice(0, 4).map((c) => ({
        code: c.competency?.code ?? '',
        title: c.competency?.title ?? '',
        score0to4: c.score0to4 === null ? null : Number(c.score0to4),
        level: c.level,
      })),
      riskFlagCount: session.riskFlags.length,
      criticalRiskFlagCount: session.riskFlags.filter((f) => f.severity === 'HIGH').length,
      reviewRequired: session.reviewRequired,
      reviewCompletedAt: session.reviewCompletedAt,
      anonymized: session.candidate.anonymizedAt !== null,
    };
  });

  // Сортировка по баллу выполняется после выборки: балл лежит в связанной
  // таблице и зависит от активной версии FinalScore.
  if (query.sort === 'score') {
    items.sort((a, b) => {
      const av = a.overall ?? -1;
      const bv = b.overall ?? -1;
      return query.order === 'asc' ? av - bv : bv - av;
    });
  }
  if (query.sort === 'confidence') {
    items.sort((a, b) => {
      const av = a.confidence ?? -1;
      const bv = b.confidence ?? -1;
      return query.order === 'asc' ? av - bv : bv - av;
    });
  }

  return { items, total, page, pageSize };
}

export interface DashboardCounters {
  invited: number;
  started: number;
  completed: number;
  reviewRequired: number;
  scored: number;
  pendingAssessment: number;
}

/** Сводка для дашборда HR (§26). */
export async function dashboardCounters(positionCode?: string): Promise<DashboardCounters> {
  const candidateFilter = positionCode ? { position: { code: positionCode } } : undefined;

  const [invited, started, completed, reviewRequired, scored, pending] = await Promise.all([
    prisma.invitation.count({
      where: { ...(candidateFilter ? { candidate: candidateFilter } : {}) },
    }),
    prisma.testSession.count({
      where: {
        status: { in: ['IN_PROGRESS', 'COMPLETED', 'EXPIRED'] },
        ...(candidateFilter ? { candidate: candidateFilter } : {}),
      },
    }),
    prisma.testSession.count({
      where: { status: 'COMPLETED', ...(candidateFilter ? { candidate: candidateFilter } : {}) },
    }),
    prisma.testSession.count({
      where: {
        reviewRequired: true,
        reviewCompletedAt: null,
        ...(candidateFilter ? { candidate: candidateFilter } : {}),
      },
    }),
    prisma.testSession.count({
      where: { assessmentStatus: 'DONE', ...(candidateFilter ? { candidate: candidateFilter } : {}) },
    }),
    prisma.testSession.count({
      where: {
        assessmentStatus: { in: ['PENDING', 'RUNNING'] },
        ...(candidateFilter ? { candidate: candidateFilter } : {}),
      },
    }),
  ]);

  return {
    invited,
    started,
    completed,
    reviewRequired,
    scored,
    pendingAssessment: pending,
  };
}

export interface ComparisonEntry {
  candidateId: string;
  sessionId: string;
  fullName: string;
  positionTitle: string;
  overall: number | null;
  band: BandCode | null;
  bandTitle: string | null;
  confidence: number;
  coverage: number | null;
  competencies: Array<{
    code: string;
    title: string;
    score0to4: number | null;
    level: number | null;
    levelTitle: string | null;
    confidence: number;
    notEnoughEvidence: boolean;
  }>;
  axes: Array<{ axis: string; score0to100: number | null; confidence: number }>;
  riskFlags: Array<{ code: string; severity: string; explanation: string }>;
  constructs: Array<{ poleLeft: string; poleRight: string; importanceRank: number | null }>;
  expertReviews: number;
}

export interface ComparisonResult {
  entries: ComparisonEntry[];
  /** Компетенции, встречающиеся хотя бы у одного кандидата (для таблицы). */
  competencyColumns: Array<{ code: string; title: string }>;
  notes: string[];
}

const MAX_COMPARE = 5;

/** Сравнение до пяти кандидатов (§47). Автоматический рейтинг не формируется. */
export async function compareCandidates(sessionIds: string[]): Promise<ComparisonResult> {
  if (sessionIds.length < 2) throw badRequest('Для сравнения укажите не менее двух сессий');
  if (sessionIds.length > MAX_COMPARE) {
    throw badRequest(`Одновременное сравнение поддерживается для не более ${MAX_COMPARE} кандидатов`);
  }

  const sessions = await prisma.testSession.findMany({
    where: { id: { in: sessionIds } },
    include: {
      candidate: { include: { position: { select: { title: true } } } },
      finalScores: {
        where: { supersededAt: null },
        include: { competency: { select: { code: true, title: true } } },
      },
      riskFlags: { where: { dismissedAt: null }, select: { code: true, severity: true, explanation: true } },
      constructs: {
        where: { isDuplicateOf: null },
        select: { poleLeft: true, poleRight: true, importanceRank: true },
        orderBy: { importanceRank: 'asc' },
        take: 10,
      },
    },
  });

  if (sessions.length !== sessionIds.length) throw notFound('Часть сессий не найдена');

  const columnMap = new Map<string, string>();
  const entries: ComparisonEntry[] = [];

  for (const session of sessions) {
    const overall = session.finalScores.find((s) => !s.competencyId && !s.axis);
    const competencies = session.finalScores.filter((s) => s.competencyId);
    for (const c of competencies) {
      if (c.competency) columnMap.set(c.competency.code, c.competency.title);
    }
    const reviewCount = await prisma.humanReview.count({ where: { answer: { sessionId: session.id } } });

    entries.push({
      candidateId: session.candidateId,
      sessionId: session.id,
      fullName: session.candidate.fullName,
      positionTitle: session.candidate.position.title,
      overall: overall?.score0to100 === null || overall?.score0to100 === undefined ? null : Number(overall.score0to100),
      band: (overall?.band as BandCode | null) ?? null,
      bandTitle: overall?.band ? BAND_TITLES[overall.band as BandCode] : null,
      confidence: overall ? Number(overall.confidence) : 0,
      coverage: overall?.coverage === null || overall?.coverage === undefined ? null : Number(overall.coverage),
      competencies: competencies.map((c) => ({
        code: c.competency?.code ?? '',
        title: c.competency?.title ?? '',
        score0to4: c.score0to4 === null ? null : Number(c.score0to4),
        level: c.level,
        levelTitle: c.level === null ? null : (LEVEL_TITLES[c.level] ?? null),
        confidence: Number(c.confidence),
        notEnoughEvidence: c.notEnoughEvidence,
      })),
      axes: session.finalScores
        .filter((s) => s.axis && !s.competencyId)
        .map((s) => ({
          axis: s.axis as string,
          score0to100: s.score0to100 === null ? null : Number(s.score0to100),
          confidence: Number(s.confidence),
        })),
      riskFlags: session.riskFlags,
      constructs: session.constructs,
      expertReviews: reviewCount,
    });
  }

  return {
    entries,
    competencyColumns: [...columnMap.entries()].map(([code, title]) => ({ code, title })),
    notes: [
      'Сравнение не формирует автоматического рейтинга по итоговому баллу.',
      'Кандидаты с разным покрытием данными не сопоставимы напрямую: сравнивайте по компетенциям с учётом уверенности.',
      'Различие итоговых баллов в пределах уровня уверенности не является значимым.',
    ],
  };
}

/** Данные после трудоустройства (§30). Требует отдельного права. */
export async function recordEmploymentOutcome(
  candidateId: string,
  input: {
    hiringDecision?: string | null;
    decisionDate?: Date | null;
    probationResult?: string | null;
    probationScore?: number | null;
    performanceNotes?: string | null;
    followUpAssessment?: number | null;
  },
  actor: { userId: string; ip?: string | null; requestId?: string | null },
) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw notFound('Кандидат не найден');

  const previous = await prisma.employmentOutcome.findUnique({ where: { candidateId } });

  const outcome = await prisma.employmentOutcome.upsert({
    where: { candidateId },
    update: {
      hiringDecision: input.hiringDecision ?? null,
      decisionDate: input.decisionDate ?? null,
      probationResult: input.probationResult ?? null,
      probationScore: input.probationScore ?? null,
      performanceNotes: input.performanceNotes ?? null,
      followUpAssessment: input.followUpAssessment ?? null,
      recordedByUserId: actor.userId,
    },
    create: {
      candidateId,
      hiringDecision: input.hiringDecision ?? null,
      decisionDate: input.decisionDate ?? null,
      probationResult: input.probationResult ?? null,
      probationScore: input.probationScore ?? null,
      performanceNotes: input.performanceNotes ?? null,
      followUpAssessment: input.followUpAssessment ?? null,
      recordedByUserId: actor.userId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.EMPLOYMENT_OUTCOME_RECORDED,
    entity: 'EmploymentOutcome',
    entityId: outcome.id,
    actorUserId: actor.userId,
    oldValue: previous
      ? {
          hiringDecision: previous.hiringDecision,
          probationResult: previous.probationResult,
          probationScore: previous.probationScore === null ? null : Number(previous.probationScore),
        }
      : null,
    newValue: input,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return outcome;
}

/** Эталонная группа: сравнение профиля кандидата с распределением группы (§48). */
export async function benchmarkComparison(benchmarkCode: string, sessionId: string) {
  const benchmark = await prisma.benchmark.findUnique({
    where: { code: benchmarkCode },
    include: { members: { select: { candidateId: true } } },
  });
  if (!benchmark) throw notFound('Эталонная группа не найдена');

  const memberIds = benchmark.members.map((m) => m.candidateId);
  if (memberIds.length === 0) {
    return {
      benchmark: { code: benchmark.code, title: benchmark.title, size: 0 },
      competencies: [],
      notes: ['Эталонная группа не содержит участников.'],
    };
  }

  const [groupScores, candidateScores] = await Promise.all([
    prisma.finalScore.findMany({
      where: {
        supersededAt: null,
        competencyId: { not: null },
        session: { candidateId: { in: memberIds }, status: 'COMPLETED' },
      },
      include: { competency: { select: { code: true, title: true } } },
    }),
    prisma.finalScore.findMany({
      where: { sessionId, supersededAt: null, competencyId: { not: null } },
      include: { competency: { select: { code: true } } },
    }),
  ]);

  const grouped = new Map<string, { title: string; values: number[] }>();
  for (const score of groupScores) {
    if (score.score0to4 === null || !score.competency) continue;
    const entry = grouped.get(score.competency.code) ?? { title: score.competency.title, values: [] };
    entry.values.push(Number(score.score0to4));
    grouped.set(score.competency.code, entry);
  }

  const candidateByCode = new Map(
    candidateScores.map((s) => [s.competency?.code ?? '', s.score0to4 === null ? null : Number(s.score0to4)]),
  );

  const competencies = [...grouped.entries()].map(([code, entry]) => {
    const sorted = [...entry.values].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0] ?? 0;
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1] ?? 0;
    const candidateValue = candidateByCode.get(code) ?? null;
    return {
      code,
      title: entry.title,
      groupMean: round3(mean),
      groupP25: round3(p25),
      groupP75: round3(p75),
      groupSize: sorted.length,
      candidateScore: candidateValue,
      /** Положение относительно группы как наблюдение, не как вывод о пригодности. */
      position:
        candidateValue === null
          ? 'нет данных'
          : candidateValue >= p75
            ? 'выше верхнего квартиля группы'
            : candidateValue <= p25
              ? 'ниже нижнего квартиля группы'
              : 'в пределах межквартильного размаха группы',
    };
  });

  return {
    benchmark: { code: benchmark.code, title: benchmark.title, size: memberIds.length },
    competencies,
    notes: [
      'Статистическая близость к эталонной группе не означает автоматически профессиональную пригодность.',
      'Эталонная группа отражает практику Заказчика и может содержать собственные систематические смещения.',
    ],
  };
}
