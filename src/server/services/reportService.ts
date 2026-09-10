import { prisma } from '../db/prisma.js';
import { notFound } from '../http/errors.js';
import { BAND_TITLES, LEVEL_TITLES, confidenceLabel } from '../scoring/engine.js';
import type { BandCode } from '../scoring/types.js';
import { RISK_FLAG_BY_CODE } from '../scoring/riskFlags.js';
import { GRID_DISCLAIMER, type GridMetrics } from '../kelly/grid.js';
import { getCriticalGaps } from './scoringService.js';

/**
 * Формирование отчёта (§45). Каждый балл сопровождается доказательствами,
 * каждая рекомендация — ссылкой на конкретный ответ (§66).
 *
 * Отчёт не содержит кадрового вердикта: только квалификационный уровень,
 * доказательства, зоны дополнительной проверки и уровень уверенности.
 */

export const REPORT_DISCLAIMERS = {
  purpose:
    'Отчёт является системой поддержки решения. Он не содержит кадрового вердикта: ' +
    'решение о найме принимает человек.',
  confidence:
    'Уровень уверенности отражает надёжность вывода (объём и согласованность ' +
    'доказательств), а не квалификацию кандидата. Низкая уверенность означает ' +
    'необходимость дополнительной проверки, а не низкий уровень специалиста.',
  notEnoughEvidence:
    'Значение «недостаточно данных» не равно нулю: оно означает, что в ответах ' +
    'не найдено доказательств для вывода по этой компетенции.',
  hardGate:
    'Критическая компетенция не отклоняет кандидата автоматически: она указывает ' +
    'на необходимость дополнительной проверки.',
  grid: GRID_DISCLAIMER,
  contradiction:
    'Расхождение между декларируемым критерием и решениями в кейсах является ' +
    'наблюдением для уточнения на собеседовании, а не выводом о недостоверности ответов.',
  protectedAttributes:
    'При расчёте оценки не используются возраст, пол, национальность, ' +
    'вероисповедание, политические убеждения, данные здоровья и семейное положение.',
} as const;

export interface CompetencyReportItem {
  competencyCode: string;
  competencyTitle: string;
  axis: string;
  weight: number;
  score0to4: number | null;
  score0to100: number | null;
  level: number | null;
  levelTitle: string | null;
  confidence: number;
  confidenceLabel: string;
  evidenceCount: number;
  questionCount: number;
  notEnoughEvidence: boolean;
  isHardGate: boolean;
  humanReviewed: boolean;
}

export interface ReportView {
  candidate: {
    id: string;
    fullName: string;
    positionTitle: string;
    positionCode: string;
    experienceYears: number | null;
    anonymized: boolean;
  };
  session: {
    id: string;
    startedAt: Date | null;
    completedAt: Date | null;
    durationMinutes: number | null;
    assessmentTitle: string;
    assessmentVersion: number;
    assessmentStatus: string;
    reviewRequired: boolean;
    reviewCompletedAt: Date | null;
  };
  overall: {
    score0to100: number | null;
    band: BandCode | null;
    bandTitle: string;
    confidence: number;
    confidenceLabel: string;
    coverage: number | null;
    insufficientData: boolean;
  };
  axes: Array<{
    axis: string;
    score0to100: number | null;
    level: number | null;
    levelTitle: string | null;
    confidence: number;
    notEnoughEvidence: boolean;
  }>;
  competencies: CompetencyReportItem[];
  strengths: Array<{ competencyCode: string; quote: string; comment: string; answerId: string }>;
  toVerify: Array<{ competencyCode: string; competencyTitle: string; reason: string; score: number | null }>;
  criticalGaps: Array<{ competencyCode: string; message: string; reason: string; score0to4: number | null }>;
  riskFlags: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    quote: string | null;
    explanation: string;
    source: string;
    answerId: string | null;
    confirmed: boolean;
    dismissed: boolean;
  }>;
  constructs: Array<{
    id: string;
    poleLeft: string;
    poleRight: string;
    importanceReason: string | null;
    rigManifestation: string | null;
    experienceExample: string | null;
    importanceRank: number | null;
    isDuplicate: boolean;
    ladder: Array<{ depth: number; question: string; answer: string; terminalTag: string | null }>;
  }>;
  grid: {
    metrics: GridMetrics | null;
    elements: Array<{ code: string; label: string }>;
    rows: Array<{ constructId: string; poleLeft: string; poleRight: string; values: Array<number | null> }>;
  };
  cases: Array<{
    scenarioCode: string;
    scenarioTitle: string;
    stages: Array<{
      stageIndex: number;
      situation: string;
      answers: Array<{ answerId: string; value: unknown; submittedAt: Date | null }>;
    }>;
  }>;
  contradictions: Array<{ description: string; strength: number; answerIds: string[] }>;
  evidence: Array<{
    competencyCode: string;
    kind: string;
    quote: string | null;
    comment: string | null;
    answerId: string;
    verified: boolean;
  }>;
  interviewQuestions: Array<{
    text: string;
    rationale: string;
    competencyCode: string | null;
    refAnswerIds: string[];
  }>;
  expertConclusion: Array<{
    competencyCode: string;
    modelScore: number | null;
    humanScore: number | null;
    finalScore: number | null;
    reviewReason: string;
    reviewerName: string;
    createdAt: Date;
  }>;
  versions: {
    assessmentVersionId: string;
    assessmentVersion: number;
    scoringModel: string | null;
    gridEngineVersion: string | null;
    llmModels: string[];
    promptTemplates: string[];
  };
  disclaimers: typeof REPORT_DISCLAIMERS;
}

export async function buildReport(sessionId: string): Promise<ReportView> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: {
      candidate: { include: { position: true } },
      version: {
        include: {
          assessment: true,
          scoringModel: true,
          competencies: { include: { competency: true }, orderBy: { orderIndex: 'asc' } },
          kellyElements: { orderBy: { orderIndex: 'asc' } },
        },
      },
      finalScores: {
        where: { supersededById: null },
        include: { competency: { select: { code: true, title: true, axis: true } } },
      },
      riskFlags: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] },
      contradictions: true,
      interviewQs: { include: { competency: { select: { code: true } } }, orderBy: { orderIndex: 'asc' } },
      gridAnalyses: { orderBy: { computedAt: 'desc' }, take: 1 },
    },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');

  const [constructs, ratings, answers, reviews] = await Promise.all([
    prisma.candidateConstruct.findMany({
      where: { sessionId },
      include: { ladderSteps: { orderBy: { depth: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.constructRating.findMany({
      where: { construct: { sessionId } },
      select: { constructId: true, elementId: true, rating: true },
    }),
    prisma.answer.findMany({
      where: { sessionId, status: 'SUBMITTED' },
      include: {
        questionVersion: {
          include: {
            question: { select: { code: true, type: true } },
            scenarioStage: {
              include: { scenario: { select: { code: true, title: true } } },
            },
          },
        },
        llmAssessments: {
          where: { status: 'OK' },
          include: {
            dimensionScores: {
              include: {
                competency: { select: { code: true, title: true } },
                evidence: true,
              },
            },
            evidence: true,
          },
        },
        humanReviews: {
          include: {
            competency: { select: { code: true } },
            reviewer: { select: { fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.humanReview.findMany({
      where: { answer: { sessionId } },
      include: {
        competency: { select: { code: true } },
        reviewer: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const overallScore = session.finalScores.find((s) => !s.competencyId && !s.axis);
  const axisScores = session.finalScores.filter((s) => s.axis && !s.competencyId);
  const competencyScores = session.finalScores.filter((s) => s.competencyId);

  const weightByCode = new Map(
    session.version.competencies.map((c) => [c.competency.code, { weight: Number(c.weight), isHardGate: c.isHardGate }]),
  );
  const humanReviewedCodes = new Set(reviews.map((r) => r.competency.code));

  const competencies: CompetencyReportItem[] = competencyScores
    .map((score) => {
      const code = score.competency?.code ?? '';
      const meta = weightByCode.get(code);
      return {
        competencyCode: code,
        competencyTitle: score.competency?.title ?? code,
        axis: score.competency?.axis ?? '',
        weight: meta?.weight ?? 0,
        score0to4: score.score0to4 === null ? null : Number(score.score0to4),
        score0to100: score.score0to100 === null ? null : Number(score.score0to100),
        level: score.level,
        levelTitle: score.level === null ? null : (LEVEL_TITLES[score.level] ?? null),
        confidence: Number(score.confidence),
        confidenceLabel: confidenceLabel(Number(score.confidence)),
        evidenceCount: score.evidenceCount,
        questionCount: score.questionCount,
        notEnoughEvidence: score.notEnoughEvidence,
        isHardGate: meta?.isHardGate ?? false,
        humanReviewed: humanReviewedCodes.has(code),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  // Доказательства: только проверенные цитаты попадают в отчёт как основания.
  const evidence: ReportView['evidence'] = [];
  const strengths: ReportView['strengths'] = [];
  for (const answer of answers) {
    for (const run of answer.llmAssessments) {
      for (const dim of run.dimensionScores) {
        for (const item of dim.evidence) {
          evidence.push({
            competencyCode: dim.competency.code,
            kind: item.kind,
            quote: item.quote,
            comment: item.comment,
            answerId: answer.id,
            verified: item.verified,
          });
          if (item.kind === 'STRENGTH' && item.verified) {
            strengths.push({
              competencyCode: dim.competency.code,
              quote: item.quote,
              comment: item.comment ?? '',
              answerId: answer.id,
            });
          }
        }
      }
      for (const item of run.evidence.filter((e) => !e.dimensionScoreId)) {
        evidence.push({
          competencyCode: '',
          kind: item.kind,
          quote: item.quote,
          comment: item.comment,
          answerId: answer.id,
          verified: item.verified,
        });
        if (item.kind === 'STRENGTH' && item.verified) {
          strengths.push({
            competencyCode: '',
            quote: item.quote,
            comment: item.comment ?? '',
            answerId: answer.id,
          });
        }
      }
    }
  }

  // Зоны дополнительной проверки: низкая уверенность или отсутствие данных.
  const toVerify: ReportView['toVerify'] = competencies
    .filter((c) => c.notEnoughEvidence || c.confidence < 0.5 || (c.score0to4 !== null && c.score0to4 < 2))
    .map((c) => ({
      competencyCode: c.competencyCode,
      competencyTitle: c.competencyTitle,
      reason: c.notEnoughEvidence
        ? 'Недостаточно данных: в ответах не найдено доказательств для вывода'
        : c.confidence < 0.5
          ? 'Низкий уровень уверенности вывода: требуется уточнение на собеседовании'
          : 'Уровень ниже операционного по итогам кейсов',
      score: c.score0to4,
    }));

  const criticalGaps = (await getCriticalGaps(sessionId)).map((g) => ({
    competencyCode: g.competencyCode,
    message: g.message,
    reason: g.reason,
    score0to4: g.score0to4,
  }));

  // Кейсы, сгруппированные по сценариям и этапам.
  const caseMap = new Map<
    string,
    { scenarioCode: string; scenarioTitle: string; stages: Map<number, { situation: string; answers: ReportView['cases'][number]['stages'][number]['answers'] }> }
  >();
  for (const answer of answers) {
    const stage = answer.questionVersion.scenarioStage;
    if (!stage) continue;
    const key = stage.scenario.code;
    const bucket =
      caseMap.get(key) ??
      { scenarioCode: stage.scenario.code, scenarioTitle: stage.scenario.title, stages: new Map() };
    const stageBucket = bucket.stages.get(stage.stageIndex) ?? { situation: stage.situation, answers: [] };
    stageBucket.answers.push({
      answerId: answer.id,
      value: answer.valueJson,
      submittedAt: answer.submittedAt,
    });
    bucket.stages.set(stage.stageIndex, stageBucket);
    caseMap.set(key, bucket);
  }

  const gridMetrics = (session.gridAnalyses[0]?.metrics as unknown as GridMetrics) ?? null;
  const ratingByCell = new Map(ratings.map((r) => [`${r.constructId}:${r.elementId}`, r.rating]));
  const activeConstructs = constructs.filter((c) => !c.isDuplicateOf);

  const durationMinutes =
    session.startedAt && session.completedAt
      ? Math.round((session.completedAt.getTime() - session.startedAt.getTime()) / 60_000)
      : null;

  const llmMeta = await prisma.lLMAssessment.findMany({
    where: { answer: { sessionId } },
    select: { llmModel: true, llmProvider: true, promptTemplate: { select: { code: true, version: true } } },
    distinct: ['llmModel', 'promptTemplateId'],
  });

  return {
    candidate: {
      id: session.candidate.id,
      fullName: session.candidate.fullName,
      positionTitle: session.candidate.position.title,
      positionCode: session.candidate.position.code,
      experienceYears: session.candidate.experienceYears,
      anonymized: session.candidate.anonymizedAt !== null,
    },
    session: {
      id: session.id,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      durationMinutes,
      assessmentTitle: session.version.assessment.title,
      assessmentVersion: session.version.version,
      assessmentStatus: session.assessmentStatus,
      reviewRequired: session.reviewRequired,
      reviewCompletedAt: session.reviewCompletedAt,
    },
    overall: {
      score0to100: overallScore?.score0to100 === undefined || overallScore.score0to100 === null
        ? null
        : Number(overallScore.score0to100),
      band: (overallScore?.band as BandCode | null) ?? null,
      bandTitle: overallScore?.band ? BAND_TITLES[overallScore.band as BandCode] : BAND_TITLES.INSUFFICIENT_DATA,
      confidence: overallScore ? Number(overallScore.confidence) : 0,
      confidenceLabel: confidenceLabel(overallScore ? Number(overallScore.confidence) : 0),
      coverage: overallScore?.coverage === null || overallScore?.coverage === undefined
        ? null
        : Number(overallScore.coverage),
      insufficientData: overallScore?.notEnoughEvidence ?? true,
    },
    axes: axisScores.map((a) => ({
      axis: a.axis as string,
      score0to100: a.score0to100 === null ? null : Number(a.score0to100),
      level: a.level,
      levelTitle: a.level === null ? null : (LEVEL_TITLES[a.level] ?? null),
      confidence: Number(a.confidence),
      notEnoughEvidence: a.notEnoughEvidence,
    })),
    competencies,
    strengths,
    toVerify,
    criticalGaps,
    riskFlags: session.riskFlags.map((f) => ({
      id: f.id,
      code: f.code,
      title: RISK_FLAG_BY_CODE.get(f.code)?.title ?? f.code,
      severity: f.severity,
      quote: f.quote,
      explanation: f.explanation,
      source: f.source,
      answerId: f.answerId,
      confirmed: f.confirmedByUserId !== null,
      dismissed: f.dismissedAt !== null,
    })),
    constructs: constructs.map((c) => ({
      id: c.id,
      poleLeft: c.poleLeft,
      poleRight: c.poleRight,
      importanceReason: c.importanceReason,
      rigManifestation: c.rigManifestation,
      experienceExample: c.experienceExample,
      importanceRank: c.importanceRank,
      isDuplicate: c.isDuplicateOf !== null,
      ladder: c.ladderSteps.map((s) => ({
        depth: s.depth,
        question: s.question,
        answer: s.answer,
        terminalTag: s.terminalTag,
      })),
    })),
    grid: {
      metrics: gridMetrics,
      elements: session.version.kellyElements.map((e) => ({ code: e.code, label: e.label })),
      rows: activeConstructs.map((c) => ({
        constructId: c.id,
        poleLeft: c.poleLeft,
        poleRight: c.poleRight,
        values: session.version.kellyElements.map((e) => ratingByCell.get(`${c.id}:${e.id}`) ?? null),
      })),
    },
    cases: [...caseMap.values()].map((c) => ({
      scenarioCode: c.scenarioCode,
      scenarioTitle: c.scenarioTitle,
      stages: [...c.stages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([stageIndex, stage]) => ({ stageIndex, situation: stage.situation, answers: stage.answers })),
    })),
    contradictions: session.contradictions.map((c) => ({
      description: c.description,
      strength: Number(c.strength),
      answerIds: (c.answerIds as unknown as string[]) ?? [],
    })),
    evidence,
    interviewQuestions: session.interviewQs.map((q) => ({
      text: q.text,
      rationale: q.rationale,
      competencyCode: q.competency?.code ?? null,
      refAnswerIds: (q.refAnswerIds as unknown as string[]) ?? [],
    })),
    expertConclusion: reviews.map((r) => ({
      competencyCode: r.competency.code,
      modelScore: r.modelScore === null ? null : Number(r.modelScore),
      humanScore: r.humanScore === null ? null : Number(r.humanScore),
      finalScore: r.finalScore === null ? null : Number(r.finalScore),
      reviewReason: r.reviewReason,
      reviewerName: r.reviewer.fullName,
      createdAt: r.createdAt,
    })),
    versions: {
      assessmentVersionId: session.assessmentVersionId,
      assessmentVersion: session.version.version,
      scoringModel: session.version.scoringModel
        ? `${session.version.scoringModel.code} v${session.version.scoringModel.version}`
        : null,
      gridEngineVersion: session.gridAnalyses[0]?.engineVersion ?? null,
      llmModels: [...new Set(llmMeta.map((m) => `${m.llmProvider}:${m.llmModel}`))],
      promptTemplates: [
        ...new Set(
          llmMeta
            .map((m) => (m.promptTemplate ? `${m.promptTemplate.code} v${m.promptTemplate.version}` : null))
            .filter((v): v is string => v !== null),
        ),
      ],
    },
    disclaimers: REPORT_DISCLAIMERS,
  };
}

export interface DrillDownView {
  competencyCode: string;
  competencyTitle: string;
  rubric: Array<{ level: number; descriptor: string }>;
  finalScore: {
    score0to4: number | null;
    level: number | null;
    confidence: number;
    notEnoughEvidence: boolean;
  } | null;
  items: Array<{
    answerId: string;
    questionCode: string;
    questionPrompt: string;
    answerValue: unknown;
    scenario: { code: string; title: string; stageIndex: number } | null;
    evaluators: Array<{
      role: string;
      score: number | null;
      notEnoughEvidence: boolean;
      confidence: number;
      explanation: string;
      rubricRule: string;
      model: string;
      provider: string;
      quotes: Array<{ quote: string; verified: boolean; kind: string }>;
    }>;
    humanReviews: Array<{
      modelScore: number | null;
      humanScore: number | null;
      finalScore: number | null;
      reviewReason: string;
      markedUninformative: boolean;
      reviewerName: string;
      createdAt: Date;
    }>;
  }>;
}

/**
 * Обязательный drill-down (§28): любой балл раскрывается до вопросов,
 * ответов, цитат, оценок каждого evaluator, применённой rubric и истории
 * ручных корректировок. «Магических» баллов в системе нет.
 */
export async function buildDrillDown(sessionId: string, competencyCode: string): Promise<DrillDownView> {
  const competency = await prisma.competency.findUnique({
    where: { code: competencyCode },
    include: { rubrics: { include: { levels: { orderBy: { level: 'asc' } } }, orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!competency) throw notFound('Компетенция не найдена');

  const finalScore = await prisma.finalScore.findFirst({
    where: { sessionId, competencyId: competency.id, supersededById: null },
  });

  const answers = await prisma.answer.findMany({
    where: {
      sessionId,
      status: 'SUBMITTED',
      OR: [
        { questionVersion: { competencies: { some: { competencyId: competency.id } } } },
        { llmAssessments: { some: { dimensionScores: { some: { competencyId: competency.id } } } } },
      ],
    },
    include: {
      questionVersion: {
        include: {
          question: { select: { code: true } },
          scenarioStage: { include: { scenario: { select: { code: true, title: true } } } },
        },
      },
      llmAssessments: {
        where: { status: 'OK' },
        include: {
          dimensionScores: {
            where: { competencyId: competency.id },
            include: { evidence: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      humanReviews: {
        where: { competencyId: competency.id },
        include: { reviewer: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    competencyCode,
    competencyTitle: competency.title,
    rubric: competency.rubrics[0]?.levels.map((l) => ({ level: l.level, descriptor: l.descriptor })) ?? [],
    finalScore: finalScore
      ? {
          score0to4: finalScore.score0to4 === null ? null : Number(finalScore.score0to4),
          level: finalScore.level,
          confidence: Number(finalScore.confidence),
          notEnoughEvidence: finalScore.notEnoughEvidence,
        }
      : null,
    items: answers.map((answer) => ({
      answerId: answer.id,
      questionCode: answer.questionVersion.question.code,
      questionPrompt: answer.questionVersion.prompt,
      answerValue: answer.valueJson,
      scenario: answer.questionVersion.scenarioStage
        ? {
            code: answer.questionVersion.scenarioStage.scenario.code,
            title: answer.questionVersion.scenarioStage.scenario.title,
            stageIndex: answer.questionVersion.scenarioStage.stageIndex,
          }
        : null,
      evaluators: answer.llmAssessments.flatMap((run) =>
        run.dimensionScores.map((dim) => ({
          role: run.evaluatorRole,
          score: dim.score === null ? null : Number(dim.score),
          notEnoughEvidence: dim.notEnoughEvidence,
          confidence: Number(dim.confidence),
          explanation: dim.explanation,
          rubricRule: dim.rubricRule ?? '',
          model: run.llmModel,
          provider: run.llmProvider,
          quotes: dim.evidence.map((e) => ({ quote: e.quote, verified: e.verified, kind: e.kind })),
        })),
      ),
      humanReviews: answer.humanReviews.map((r) => ({
        modelScore: r.modelScore === null ? null : Number(r.modelScore),
        humanScore: r.humanScore === null ? null : Number(r.humanScore),
        finalScore: r.finalScore === null ? null : Number(r.finalScore),
        reviewReason: r.reviewReason,
        markedUninformative: r.markedUninformative,
        reviewerName: r.reviewer.fullName,
        createdAt: r.createdAt,
      })),
    })),
  };
}
