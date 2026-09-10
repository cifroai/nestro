import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { notFound } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import {
  applyHumanReview,
  calculateAssessmentScore,
  calculateAxisScores,
  calculateCompetencyScore,
  combineEvaluators,
  detectCriticalGaps,
  detectRuleFlags,
  detectCrossAnswerContradictions,
  NOT_ENOUGH_EVIDENCE,
  type AnswerScoreInput,
  type AxisCode,
  type AxisMap,
  type BandThresholds,
  type CompetencyConfig,
  type CompetencyScore,
  type Declaration,
  type Judgement,
  type ScoringParams,
  type SessionSnapshot,
  DEFAULT_SCORING_PARAMS,
} from '../scoring/index.js';
import { computeAndStoreGridMetrics } from './kellyService.js';
import { mapConstructsToCompetencies } from './constructMapping.js';
import { logger } from '../logging/logger.js';

/**
 * Оркестрация скоринга: загружает суждения оценщиков и экспертные
 * корректировки, вызывает чистый модуль scoring и сохраняет результат.
 *
 * Пересчёт всегда создаёт НОВЫЕ записи FinalScore, помечая предыдущие
 * через supersededById. Молчаливого пересчёта исторических результатов нет (§32).
 */

export interface FinalizeOptions {
  reason: 'INITIAL' | 'HUMAN_REVIEW' | 'RECOMPUTE';
  actorUserId?: string | null;
  requestId?: string | null;
}

export interface FinalizeResult {
  sessionId: string;
  overall: number | null;
  band: string;
  coverage: number;
  confidence: number;
  reviewRequired: boolean;
  criticalGaps: number;
  riskFlags: number;
  contradictions: number;
  competencyCount: number;
}

async function loadScoringParams(assessmentVersionId: string): Promise<{
  params: ScoringParams;
  competencies: Array<CompetencyConfig & { competencyId: string; axis: AxisCode }>;
  scoringModelId: string | null;
}> {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    include: { competencies: { include: { competency: true }, orderBy: { orderIndex: 'asc' } } },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');

  const bandThresholds = version.bandThresholds as unknown as BandThresholds;

  return {
    params: {
      ...DEFAULT_SCORING_PARAMS,
      disagreementThreshold: Number(version.disagreementThreshold),
      gateThreshold: Number(version.gateThreshold),
      minCoverage: Number(version.minCoverage),
      bandThresholds: bandThresholds ?? DEFAULT_SCORING_PARAMS.bandThresholds,
    },
    competencies: version.competencies.map((c) => ({
      competencyId: c.competencyId,
      competencyCode: c.competency.code,
      axis: c.competency.axis as AxisCode,
      weight: Number(c.weight),
      isHardGate: c.isHardGate,
      minEvidenceCount: c.minEvidenceCount,
      minQuestionCount: c.minQuestionCount,
    })),
    scoringModelId: version.scoringModelId,
  };
}

/**
 * Собирает по компетенциям вклад каждого ответа: суждения A и B,
 * экспертную корректировку и число подтверждённых доказательств.
 */
async function collectAnswerInputs(
  sessionId: string,
  params: ScoringParams,
): Promise<Map<string, AnswerScoreInput[]>> {
  const answers = await prisma.answer.findMany({
    where: { sessionId, status: 'SUBMITTED' },
    select: {
      id: true,
      questionVersionId: true,
      questionVersion: {
        select: { competencies: { select: { competencyId: true, weightWithinCompetency: true } } },
      },
      llmAssessments: {
        where: { status: 'OK' },
        orderBy: { attempt: 'desc' },
        select: {
          evaluatorRole: true,
          dimensionScores: {
            select: {
              id: true,
              competencyId: true,
              score: true,
              notEnoughEvidence: true,
              confidence: true,
              evidence: { where: { kind: 'SUPPORTING', verified: true }, select: { id: true } },
            },
          },
        },
      },
      humanReviews: {
        orderBy: { createdAt: 'desc' },
        select: { competencyId: true, humanScore: true, markedUninformative: true },
      },
    },
  });

  const byCompetency = new Map<string, AnswerScoreInput[]>();

  for (const answer of answers) {
    const questionWeights = new Map(
      answer.questionVersion.competencies.map((qc) => [
        qc.competencyId,
        Number(qc.weightWithinCompetency),
      ]),
    );

    // Последний прогон каждой роли.
    const judgementsByCompetency = new Map<
      string,
      { A?: Judgement; B?: Judgement; evidence: number }
    >();

    for (const run of answer.llmAssessments) {
      for (const dim of run.dimensionScores) {
        const entry = judgementsByCompetency.get(dim.competencyId) ?? { evidence: 0 };
        const judgement: Judgement = {
          score: dim.notEnoughEvidence || dim.score === null ? NOT_ENOUGH_EVIDENCE : Number(dim.score),
          confidence: Number(dim.confidence),
        };
        if (run.evaluatorRole === 'A' && !entry.A) entry.A = judgement;
        if (run.evaluatorRole === 'B' && !entry.B) entry.B = judgement;
        entry.evidence = Math.max(entry.evidence, dim.evidence.length);
        judgementsByCompetency.set(dim.competencyId, entry);
      }
    }

    const reviewByCompetency = new Map<string, { humanScore: number | null; markedUninformative: boolean }>();
    for (const review of answer.humanReviews) {
      if (reviewByCompetency.has(review.competencyId)) continue;
      reviewByCompetency.set(review.competencyId, {
        humanScore: review.humanScore === null ? null : Number(review.humanScore),
        markedUninformative: review.markedUninformative,
      });
    }

    // Компетенции, по которым есть суждение либо экспертная оценка.
    const competencyIds = new Set<string>([
      ...judgementsByCompetency.keys(),
      ...reviewByCompetency.keys(),
    ]);

    for (const competencyId of competencyIds) {
      const entry = judgementsByCompetency.get(competencyId);
      const combined = combineEvaluators(
        entry?.A ?? null,
        entry?.B ?? null,
        params.disagreementThreshold,
      );
      const effective = applyHumanReview(combined, reviewByCompetency.get(competencyId) ?? null);

      const input: AnswerScoreInput = {
        answerId: answer.id,
        questionVersionId: answer.questionVersionId,
        weight: questionWeights.get(competencyId) ?? 1,
        supportingEvidenceCount: entry?.evidence ?? 0,
        effective,
      };
      const bucket = byCompetency.get(competencyId);
      if (bucket) bucket.push(input);
      else byCompetency.set(competencyId, [input]);
    }
  }

  return byCompetency;
}

/** Снимок сессии для детерминированных детекторов (docs/SCORING.md §12). */
async function buildSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const [answers, ratings] = await Promise.all([
    prisma.answer.findMany({
      where: { sessionId, status: 'SUBMITTED' },
      select: {
        id: true,
        valueJson: true,
        textValue: true,
        questionVersion: { select: { question: { select: { type: true } } } },
      },
    }),
    prisma.constructRating.findMany({
      where: { construct: { sessionId, isDuplicateOf: null } },
      select: { rating: true },
    }),
  ]);

  const triadAnswers: SessionSnapshot['triadAnswers'] = [];
  const caseAnswers: SessionSnapshot['caseAnswers'] = [];
  const openAnswers: SessionSnapshot['openAnswers'] = [];

  for (const answer of answers) {
    const value = answer.valueJson as Record<string, unknown> | null;
    const kind = value?.kind;

    if (kind === 'KELLY_TRIAD') {
      triadAnswers.push({
        answerId: answer.id,
        experienceExample: (value?.experienceExample as string | undefined) ?? null,
      });
    }

    if (kind === 'CASE') {
      const fields = (value?.fields ?? {}) as Record<string, string>;
      caseAnswers.push({
        answerId: answer.id,
        missingInformation: fields.missingInformation ?? null,
        successCriterion: fields.successCriterion ?? null,
        escalationTrigger: fields.escalationTrigger ?? null,
      });
    }

    if (answer.textValue && answer.textValue.trim().length > 0) {
      const type = answer.questionVersion.question.type;
      if (type === 'LONG_ANSWER' || type === 'SHORT_ANSWER' || type === 'MULTI_STAGE_CASE' || type === 'SJT') {
        openAnswers.push({ answerId: answer.id, text: answer.textValue });
      }
    }
  }

  return {
    triadAnswers,
    caseAnswers,
    openAnswers,
    grid: { ratings: ratings.map((r) => r.rating) },
  };
}

/** Декларации кандидата для проверки согласованности (§22). */
async function buildDeclarations(sessionId: string): Promise<Declaration[]> {
  const [constructs, competencies] = await Promise.all([
    prisma.candidateConstruct.findMany({
      where: { sessionId, isDuplicateOf: null },
      select: {
        id: true,
        poleLeft: true,
        poleRight: true,
        importanceReason: true,
        rigManifestation: true,
        importanceRank: true,
      },
    }),
    prisma.competency.findMany({ select: { code: true, title: true, description: true } }),
  ]);

  const mappings = mapConstructsToCompetencies(
    constructs,
    competencies.map((c) => ({ code: c.code, title: c.title, description: c.description ?? '' })),
  );

  const byId = new Map(constructs.map((c) => [c.id, c]));
  const declarations: Declaration[] = [];
  for (const mapping of mappings) {
    const construct = byId.get(mapping.constructId);
    if (!construct || construct.importanceRank === null) continue;
    // Ответы, из которых выведена декларация: ответ на триаду конструкта.
    const answers = await prisma.answer.findMany({
      where: { sessionId, valueJson: { path: ['kind'], equals: 'KELLY_TRIAD' } },
      select: { id: true },
      take: 20,
    });
    declarations.push({
      constructId: construct.id,
      poleLeft: construct.poleLeft,
      poleRight: construct.poleRight,
      competencyCode: mapping.competencyCode,
      importanceRank: construct.importanceRank,
      sourceAnswerIds: answers.map((a) => a.id).slice(0, 5),
    });
  }
  return declarations;
}

/**
 * Полный пересчёт итоговых баллов сессии.
 * Вызывается из очереди после оценки ответов и после экспертной проверки.
 */
export async function finalizeScoring(
  sessionId: string,
  options: FinalizeOptions,
): Promise<FinalizeResult> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, assessmentVersionId: true, candidateId: true },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');

  const { params, competencies, scoringModelId } = await loadScoringParams(session.assessmentVersionId);
  const inputsByCompetency = await collectAnswerInputs(sessionId, params);

  const competencyScores: CompetencyScore[] = [];
  const scoreByCompetencyId = new Map<string, CompetencyScore>();
  for (const cfg of competencies) {
    const inputs = inputsByCompetency.get(cfg.competencyId) ?? [];
    const score = calculateCompetencyScore(inputs, cfg, params);
    competencyScores.push(score);
    scoreByCompetencyId.set(cfg.competencyId, score);
  }

  const axisMap: AxisMap = Object.fromEntries(competencies.map((c) => [c.competencyCode, c.axis]));
  const gridMetrics = await computeAndStoreGridMetrics(sessionId).catch((err) => {
    logger.warn({ err, sessionId }, 'не удалось рассчитать метрики решётки');
    return null;
  });

  const axisScores = calculateAxisScores(competencyScores, axisMap);

  // Сигнал профессиональной рефлексии входит в ось SELF_AWARENESS
  // как наблюдение с весом 0.25 (docs/SCORING.md §11).
  const reflection = gridMetrics?.reflectionSignal ?? null;
  const adjustedAxisScores = axisScores.map((axis) => {
    if (axis.axis !== 'SELF_AWARENESS' || reflection === null || axis.score0to4 === null) return axis;
    const blended = 0.75 * axis.score0to4 + 0.25 * (reflection * 4);
    return {
      ...axis,
      score0to4: Number(blended.toFixed(3)),
      score0to100: Number(((blended / 4) * 100).toFixed(3)),
      level: Math.floor(blended + 0.5),
    };
  });

  const assessment = calculateAssessmentScore(competencyScores, params);
  const criticalGaps = detectCriticalGaps(competencyScores, params);

  const snapshot = await buildSessionSnapshot(sessionId);
  const ruleFlags = detectRuleFlags(snapshot);

  const declarations = await buildDeclarations(sessionId);
  const contradictions = detectCrossAnswerContradictions(declarations, competencyScores);

  const reviewRequired =
    competencyScores.some((s) => s.reviewRequired) ||
    criticalGaps.length > 0 ||
    assessment.insufficientData ||
    assessment.confidence < 0.5;

  const competencyIdByCode = new Map(competencies.map((c) => [c.competencyCode, c.competencyId]));

  await prisma.$transaction(async (tx) => {
    // Предыдущие действующие записи помечаются устаревшими, но сохраняются (§32).
    const previous = await tx.finalScore.findMany({
      where: { sessionId, supersededById: null },
      select: { id: true, competencyId: true, axis: true },
    });

    const created: Array<{ id: string; competencyId: string | null; axis: AxisCode | null }> = [];

    for (const score of competencyScores) {
      const competencyId = competencyIdByCode.get(score.competencyCode);
      if (!competencyId) continue;
      const record = await tx.finalScore.create({
        data: {
          sessionId,
          competencyId,
          score0to4: score.score0to4,
          score0to100: score.score0to100,
          level: score.level,
          confidence: score.confidence,
          evidenceCount: score.evidenceCount,
          questionCount: score.questionCount,
          notEnoughEvidence: score.notEnoughEvidence,
          band: null,
          scoringModelId,
        },
      });
      created.push({ id: record.id, competencyId, axis: null });
    }

    for (const axis of adjustedAxisScores) {
      const record = await tx.finalScore.create({
        data: {
          sessionId,
          competencyId: null,
          axis: axis.axis,
          score0to4: axis.score0to4,
          score0to100: axis.score0to100,
          level: axis.level,
          confidence: axis.confidence,
          notEnoughEvidence: axis.notEnoughEvidence,
          scoringModelId,
        },
      });
      created.push({ id: record.id, competencyId: null, axis: axis.axis });
    }

    const overallRecord = await tx.finalScore.create({
      data: {
        sessionId,
        competencyId: null,
        axis: null,
        score0to4: assessment.overall0to4,
        score0to100: assessment.overall0to100,
        level: assessment.overall0to4 === null ? null : Math.floor(assessment.overall0to4 + 0.5),
        confidence: assessment.confidence,
        coverage: assessment.coverage,
        notEnoughEvidence: assessment.insufficientData,
        band: assessment.band,
        scoringModelId,
      },
    });
    created.push({ id: overallRecord.id, competencyId: null, axis: null });

    // Связываем старые записи с новыми: старая ссылается на заменившую её.
    for (const old of previous) {
      const replacement = created.find(
        (c) => c.competencyId === old.competencyId && c.axis === old.axis,
      );
      if (replacement) {
        await tx.finalScore.update({
          where: { id: old.id },
          data: { supersededById: replacement.id },
        });
      }
    }

    // Маркеры риска: правила пересоздаются, LLM-флаги остаются как есть.
    await tx.riskFlag.deleteMany({ where: { sessionId, source: 'RULE' } });
    for (const flag of ruleFlags) {
      await tx.riskFlag.create({
        data: {
          sessionId,
          answerId: flag.answerId,
          code: flag.code,
          severity: flag.severity,
          quote: flag.quote,
          explanation: flag.explanation,
          source: 'RULE',
        },
      });
    }

    await tx.contradiction.deleteMany({ where: { sessionId } });
    for (const contradiction of contradictions) {
      await tx.contradiction.create({
        data: {
          sessionId,
          constructId: contradiction.constructId,
          competencyId: competencyIdByCode.get(contradiction.competencyCode) ?? null,
          answerIds: contradiction.answerIds as unknown as Prisma.InputJsonValue,
          description: contradiction.description,
          strength: contradiction.strength,
        },
      });
    }

    await tx.testSession.update({
      where: { id: sessionId },
      data: { assessmentStatus: 'DONE', reviewRequired },
    });
  });

  await recordAudit({
    action:
      options.reason === 'INITIAL' ? AUDIT_ACTIONS.SCORING_COMPUTED : AUDIT_ACTIONS.SCORING_RECOMPUTED,
    entity: 'TestSession',
    entityId: sessionId,
    actorUserId: options.actorUserId ?? null,
    actorKind: options.actorUserId ? 'USER' : 'SYSTEM',
    newValue: {
      reason: options.reason,
      overall: assessment.overall0to100,
      band: assessment.band,
      coverage: assessment.coverage,
      confidence: assessment.confidence,
      scoringModelId,
      gridEngineVersion: gridMetrics?.engineVersion ?? null,
      criticalGaps: criticalGaps.map((g) => g.competencyCode),
      reviewRequired,
    },
    requestId: options.requestId ?? null,
  });

  return {
    sessionId,
    overall: assessment.overall0to100,
    band: assessment.band,
    coverage: assessment.coverage,
    confidence: assessment.confidence,
    reviewRequired,
    criticalGaps: criticalGaps.length,
    riskFlags: ruleFlags.length,
    contradictions: contradictions.length,
    competencyCount: competencyScores.length,
  };
}

/** Критические компетенции сессии для отчёта (не отклоняют кандидата). */
export async function getCriticalGaps(sessionId: string) {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { assessmentVersionId: true },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');
  const { params, competencies } = await loadScoringParams(session.assessmentVersionId);

  const scores = await prisma.finalScore.findMany({
    where: { sessionId, supersededById: null, competencyId: { not: null } },
    include: { competency: { select: { code: true, title: true } } },
  });

  const configByCode = new Map(competencies.map((c) => [c.competencyCode, c]));
  const competencyScores: CompetencyScore[] = scores.map((s) => {
    const cfg = configByCode.get(s.competency?.code ?? '');
    return {
      competencyCode: s.competency?.code ?? '',
      weight: cfg?.weight ?? 0,
      score0to4: s.score0to4 === null ? null : Number(s.score0to4),
      score0to100: s.score0to100 === null ? null : Number(s.score0to100),
      level: s.level,
      confidence: Number(s.confidence),
      evidenceCount: s.evidenceCount,
      questionCount: s.questionCount,
      notEnoughEvidence: s.notEnoughEvidence,
      humanReviewedCount: 0,
      reviewRequired: false,
      isHardGate: cfg?.isHardGate ?? false,
    };
  });

  return detectCriticalGaps(competencyScores, params);
}
