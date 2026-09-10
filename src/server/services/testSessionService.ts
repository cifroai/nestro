import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { generateToken } from '../auth/tokens.js';
import { badRequest, conflict, forbidden, gone, notFound } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import {
  buildPlan,
  computeProgress,
  nextStep,
  sectionOf,
  type NextStep,
  type PlannerConfig,
  type PlannerState,
  type SessionPlan,
} from './sessionPlanner.js';
import {
  extractAnswerText,
  extractNumericValue,
  validateSubFields,
  type AnswerValue,
  type SaveAnswerInput,
  type SubFieldDefinition,
} from '../validation/answers.js';
import {
  createConstructFromTriad,
  answerSimilarityCheck,
  saveGridRating,
  isGridComplete,
  selectLadderTargets,
  saveLadderStep,
  ladderProgress,
} from './kellyService.js';
import { resolveInvitationForStart, markInvitationStatus } from './invitationService.js';
import { issueCandidateToken } from '../auth/candidateSession.js';
import { logger } from '../logging/logger.js';

/**
 * Движок прохождения теста (§53, §25, §36).
 *
 * Ключевые свойства:
 *  — сессия привязана к конкретной AssessmentVersion; последующие правки теста
 *    не влияют на начатую сессию;
 *  — каждый значимый ответ сохраняется на сервере с историей ревизий;
 *  — восстановление после разрыва соединения возвращает кандидата на тот же шаг.
 */

export interface CandidateCtx {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

async function loadPlannerConfig(assessmentVersionId: string): Promise<PlannerConfig> {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    include: {
      kellyTriads: { orderBy: { orderIndex: 'asc' } },
      scenarios: {
        where: { isActive: true },
        include: { stages: { orderBy: { stageIndex: 'asc' } } },
        orderBy: { orderIndex: 'asc' },
      },
      questionVersions: {
        where: { isActive: true },
        select: {
          id: true,
          section: true,
          orderIndex: true,
          scenarioStageId: true,
          question: { select: { code: true, type: true } },
        },
        orderBy: { orderIndex: 'asc' },
      },
    },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');

  const triadQuestionByCode = new Map<string, string>();
  for (const qv of version.questionVersions) {
    if (qv.question.type === 'KELLY_TRIAD') {
      const match = /_KELLY_(T\d+)$/.exec(qv.question.code);
      if (match?.[1]) triadQuestionByCode.set(match[1], qv.id);
    }
  }

  const stageQuestions = new Map<string, string[]>();
  for (const qv of version.questionVersions) {
    if (!qv.scenarioStageId) continue;
    const bucket = stageQuestions.get(qv.scenarioStageId);
    if (bucket) bucket.push(qv.id);
    else stageQuestions.set(qv.scenarioStageId, [qv.id]);
  }

  return {
    targetConstructCount: version.targetConstructCount,
    minConstructCount: 7,
    ladderConstructCount: version.ladderConstructCount,
    triads: version.kellyTriads
      .filter((t) => triadQuestionByCode.has(t.code))
      .map((t) => ({
        id: t.id,
        code: t.code,
        questionVersionId: triadQuestionByCode.get(t.code) as string,
        randomizable: t.randomizable,
        isReserve: t.isReserve,
        orderIndex: t.orderIndex,
      })),
    gridQuestionVersionId:
      version.questionVersions.find((q) => q.question.type === 'REPERTORY_GRID')?.id ?? null,
    scenarios: version.scenarios.map((s) => ({
      id: s.id,
      code: s.code,
      equivalenceGroup: s.equivalenceGroup,
      orderIndex: s.orderIndex,
      stages: s.stages.map((stage) => ({
        id: stage.id,
        stageIndex: stage.stageIndex,
        questionVersionIds: stageQuestions.get(stage.id) ?? [],
      })),
    })),
    argumentationQuestionVersionIds: version.questionVersions
      .filter((q) => q.section === 'ARGUMENTATION')
      .map((q) => q.id),
    selfRatingQuestionVersionIds: version.questionVersions
      .filter((q) => q.section === 'SELF_RATING')
      .map((q) => q.id),
  };
}

async function loadPlannerState(sessionId: string, config: PlannerConfig): Promise<PlannerState> {
  const [session, answers, constructs, pendingCheck] = await Promise.all([
    prisma.testSession.findUniqueOrThrow({ where: { id: sessionId }, select: { randomSeed: true } }),
    prisma.answer.findMany({
      where: { sessionId, status: 'SUBMITTED' },
      select: { questionVersionId: true },
    }),
    prisma.candidateConstruct.findMany({
      where: { sessionId, isDuplicateOf: null },
      select: { id: true, importanceRank: true },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.constructSimilarityCheck.findFirst({
      where: { candidateVerdict: 'PENDING', constructA: { sessionId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
  ]);

  const gridComplete = await isGridComplete(sessionId);
  const ladder = await ladderProgress(sessionId);
  const ladderTargets = gridComplete ? await selectLadderTargets(sessionId, config.ladderConstructCount) : [];

  return {
    seed: session.randomSeed,
    submittedQuestionVersionIds: new Set(answers.map((a) => a.questionVersionId)),
    uniqueConstructCount: constructs.length,
    pendingSimilarityCheckId: pendingCheck?.id ?? null,
    gridComplete,
    ladderDepths: ladder.depths,
    ladderConstructIds: ladderTargets,
    ladderCompleted: ladder.completed,
  };
}

export interface SessionStartResult {
  sessionId: string;
  candidateToken: string;
  tokenExpiresAt: Date;
  resumed: boolean;
}

/** Старт или продолжение сессии по одноразовой ссылке (§54). */
export async function startSession(
  token: string,
  ctx: CandidateCtx,
): Promise<SessionStartResult> {
  const invitation = await resolveInvitationForStart(token);

  const completed = invitation.sessions.find((s) => s.status === 'COMPLETED');
  if (completed) throw gone('Тестирование по этому приглашению уже завершено');

  const active = invitation.sessions.find(
    (s) => s.status === 'IN_PROGRESS' || s.status === 'NOT_STARTED',
  );

  if (active) {
    const issued = await issueCandidateToken(active.id, ctx);
    await prisma.testSession.update({
      where: { id: active.id },
      data: { lastActivityAt: new Date(), status: 'IN_PROGRESS', startedAt: active.startedAt ?? new Date() },
    });
    return {
      sessionId: active.id,
      candidateToken: issued.token,
      tokenExpiresAt: issued.expiresAt,
      resumed: true,
    };
  }

  if (invitation.attemptsUsed >= invitation.maxAttempts) {
    throw conflict('Исчерпано число попыток прохождения по этому приглашению');
  }

  const config = await loadPlannerConfig(invitation.assessmentVersionId);
  const seed = generateToken(12);
  const plan = buildPlan(config, seed);

  const session = await prisma.testSession.create({
    data: {
      candidateId: invitation.candidateId,
      invitationId: invitation.id,
      assessmentVersionId: invitation.assessmentVersionId,
      status: 'IN_PROGRESS',
      assessmentStatus: 'NOT_STARTED',
      randomSeed: seed,
      sectionOrder: {
        triadOrder: plan.triads.map((t) => t.code),
        scenarioOrder: plan.scenarios.map((s) => s.code),
        estimatedSteps: plan.estimatedSteps,
      } as Prisma.InputJsonValue,
      currentSection: 'KELLY_TRIADS',
      startedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: 'IN_PROGRESS', attemptsUsed: { increment: 1 } },
  });

  await prisma.consentRecord.create({
    data: {
      candidateId: invitation.candidateId,
      policyVersion: 'v1',
      text:
        'Согласие на обработку профессиональных данных, предоставленных в рамках ' +
        'дистанционной оценки квалификации. Защищаемые характеристики не собираются.',
      ip: ctx.ip ?? null,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.SESSION_STARTED,
    entity: 'TestSession',
    entityId: session.id,
    actorKind: 'CANDIDATE',
    actorLabel: invitation.candidateId,
    newValue: { assessmentVersionId: invitation.assessmentVersionId, seed },
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });

  const issued = await issueCandidateToken(session.id, ctx);
  return {
    sessionId: session.id,
    candidateToken: issued.token,
    tokenExpiresAt: issued.expiresAt,
    resumed: false,
  };
}

export interface SessionStateView {
  sessionId: string;
  status: string;
  progressPercent: number;
  currentSection: string;
  positionTitle: string;
  assessmentTitle: string;
  deadline: Date | null;
  /** Ориентировочная структура и текущее положение. */
  sections: Array<{ section: string; completed: number; total: number }>;
  step: NextStep;
  stepPayload: unknown;
}

/** Полное состояние сессии для восстановления после разрыва соединения. */
export async function getSessionState(sessionId: string): Promise<SessionStateView> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: {
      version: { include: { assessment: { include: { position: true } } } },
      invitation: { select: { expiresAt: true } },
    },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');

  const config = await loadPlannerConfig(session.assessmentVersionId);
  const plan = buildPlan(config, session.randomSeed);
  const state = await loadPlannerState(sessionId, config);
  const step = session.status === 'COMPLETED' ? ({ kind: 'FINISH' } as NextStep) : nextStep(config, state, plan);
  const progress = computeProgress(config, state, plan);

  const submitted = state.submittedQuestionVersionIds;
  const sections = [
    {
      section: 'KELLY_TRIADS',
      completed: plan.triads.filter((t) => submitted.has(t.questionVersionId)).length,
      total: Math.min(plan.triads.length, config.targetConstructCount + 3),
    },
    { section: 'REPERTORY_GRID', completed: state.gridComplete ? 1 : 0, total: config.gridQuestionVersionId ? 1 : 0 },
    {
      section: 'LADDERING',
      completed: state.ladderConstructIds.filter((id) => state.ladderCompleted.has(id)).length,
      total: config.ladderConstructCount,
    },
    {
      section: 'SJT_CASES',
      completed: plan.scenarios.reduce(
        (acc, s) =>
          acc + s.stages.filter((st) => st.questionVersionIds.every((id) => submitted.has(id))).length,
        0,
      ),
      total: plan.scenarios.reduce((acc, s) => acc + s.stages.length, 0),
    },
    {
      section: 'ARGUMENTATION',
      completed: plan.argumentationQuestionVersionIds.filter((id) => submitted.has(id)).length,
      total: plan.argumentationQuestionVersionIds.length,
    },
    {
      section: 'SELF_RATING',
      completed: plan.selfRatingQuestionVersionIds.filter((id) => submitted.has(id)).length,
      total: plan.selfRatingQuestionVersionIds.length,
    },
  ];

  if (session.progressPercent !== progress || session.currentSection !== sectionOf(step)) {
    const section = sectionOf(step);
    await prisma.testSession.update({
      where: { id: sessionId },
      data: {
        progressPercent: progress,
        ...(section !== 'FINISH' ? { currentSection: section } : {}),
        lastActivityAt: new Date(),
      },
    });
  }

  return {
    sessionId,
    status: session.status,
    progressPercent: progress,
    currentSection: sectionOf(step),
    positionTitle: session.version.assessment.position.title,
    assessmentTitle: session.version.assessment.title,
    deadline: session.invitation?.expiresAt ?? null,
    sections,
    step,
    stepPayload: await buildStepPayload(session.assessmentVersionId, sessionId, step),
  };
}

/** Данные, необходимые UI для отображения текущего шага. */
async function buildStepPayload(
  assessmentVersionId: string,
  sessionId: string,
  step: NextStep,
): Promise<unknown> {
  switch (step.kind) {
    case 'KELLY_TRIAD': {
      const triad = await prisma.kellyTriad.findUniqueOrThrow({
        where: { id: step.triadId },
        include: { elementA: true, elementB: true, elementC: true },
      });
      const question = await prisma.questionVersion.findUniqueOrThrow({
        where: { id: step.questionVersionId },
        select: { prompt: true, helpText: true, subFields: true },
      });
      return {
        triadCode: triad.code,
        question,
        elements: [triad.elementA, triad.elementB, triad.elementC].map((e) => ({
          code: e.code,
          label: e.label,
          description: e.description,
        })),
        index: step.index,
        total: step.total,
      };
    }

    case 'CONSTRUCT_SIMILARITY_CHECK': {
      const check = await prisma.constructSimilarityCheck.findUniqueOrThrow({
        where: { id: step.checkId },
        include: {
          constructA: { select: { id: true, poleLeft: true, poleRight: true } },
          constructB: { select: { id: true, poleLeft: true, poleRight: true } },
        },
      });
      return {
        question: 'Эти критерии для вас означают одно и то же или являются разными?',
        note:
          'Система не объединяет критерии самостоятельно. Если критерии разные — ' +
          'поясните различие, и оба сохранятся.',
        constructs: [check.constructA, check.constructB],
      };
    }

    case 'REPERTORY_GRID': {
      const [constructs, elements, ratings] = await Promise.all([
        prisma.candidateConstruct.findMany({
          where: { sessionId, isDuplicateOf: null },
          select: { id: true, poleLeft: true, poleRight: true },
          orderBy: { orderIndex: 'asc' },
        }),
        prisma.kellyElement.findMany({
          where: { assessmentVersionId },
          select: { id: true, code: true, label: true },
          orderBy: { orderIndex: 'asc' },
        }),
        prisma.constructRating.findMany({
          where: { construct: { sessionId } },
          select: { constructId: true, elementId: true, rating: true },
        }),
      ]);
      return {
        constructs,
        elements,
        ratings,
        scaleLabels: [
          'полностью соответствует левому полюсу',
          'преимущественно левый полюс',
          'скорее левый',
          'промежуточное положение',
          'скорее правый',
          'преимущественно правый',
          'полностью соответствует правому полюсу',
        ],
      };
    }

    case 'LADDERING': {
      const construct = await prisma.candidateConstruct.findUniqueOrThrow({
        where: { id: step.constructId },
        select: { id: true, poleLeft: true, poleRight: true },
      });
      const steps = await prisma.ladderStep.findMany({
        where: { constructId: step.constructId },
        orderBy: { depth: 'asc' },
        select: { depth: true, question: true, answer: true },
      });
      return {
        construct,
        previousSteps: steps,
        depth: step.depth,
        question: 'Почему для вас это важно?',
      };
    }

    case 'CASE_STAGE': {
      const stage = await prisma.scenarioStage.findUniqueOrThrow({
        where: { id: step.stageId },
        include: { scenario: { select: { code: true, title: true, difficulty: true } } },
      });
      const questions = await prisma.questionVersion.findMany({
        where: { id: { in: step.questionVersionIds } },
        select: { id: true, prompt: true, helpText: true, subFields: true, minLength: true },
        orderBy: { orderIndex: 'asc' },
      });
      const drafts = await prisma.answer.findMany({
        where: { sessionId, questionVersionId: { in: step.questionVersionIds } },
        select: { questionVersionId: true, valueJson: true, status: true },
      });
      // Решение предыдущего этапа показывается кандидату, чтобы он мог его
      // осознанно подтвердить или скорректировать (§10).
      const previousStages =
        step.stageIndex > 0
          ? await prisma.answer.findMany({
              where: {
                sessionId,
                questionVersion: { scenarioStage: { scenarioId: stage.scenarioId, stageIndex: { lt: step.stageIndex } } },
                status: 'SUBMITTED',
              },
              select: { valueJson: true, questionVersion: { select: { scenarioStage: { select: { stageIndex: true } } } } },
            })
          : [];
      return {
        scenario: stage.scenario,
        stage: {
          stageIndex: stage.stageIndex,
          situation: stage.situation,
          dynamics: stage.dynamics,
          constraints: stage.constraints,
          adjacentServiceInfo: stage.adjacentServiceInfo,
          revealNote: stage.revealNote,
        },
        questions,
        drafts,
        previousStages,
      };
    }

    case 'QUESTION': {
      const question = await prisma.questionVersion.findUniqueOrThrow({
        where: { id: step.questionVersionId },
        select: {
          id: true,
          prompt: true,
          helpText: true,
          minLength: true,
          maxLength: true,
          options: true,
          subFields: true,
          question: { select: { type: true } },
        },
      });
      const draft = await prisma.answer.findFirst({
        where: { sessionId, questionVersionId: step.questionVersionId },
        select: { valueJson: true, status: true },
      });
      return { question, draft };
    }

    case 'FINISH':
      return {
        message: 'Тестирование завершено. Ответы сохранены.',
        note:
          'Результаты передаются техническому эксперту и специалисту по подбору. ' +
          'Дополнительных действий от вас не требуется.',
      };
  }
}

export interface SaveAnswerResult {
  saved: true;
  revision: number;
  progressPercent: number;
  followUp: unknown | null;
  nextStep: NextStep | null;
}

/** Сохранение ответа с историей ревизий и телеметрией (§23, §53). */
export async function saveAnswer(
  sessionId: string,
  input: SaveAnswerInput,
  _ctx: CandidateCtx = {},
): Promise<SaveAnswerResult> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, assessmentVersionId: true, invitation: { select: { expiresAt: true } } },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');
  if (session.status === 'COMPLETED') throw gone('Тестирование уже завершено');
  if (session.invitation && session.invitation.expiresAt <= new Date()) {
    await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'EXPIRED' } });
    throw gone('Срок прохождения тестирования истёк');
  }

  const value = input.value;
  let followUp: unknown | null = null;

  // Шаги Kelly сохраняются в собственных сущностях, а не как обычный ответ.
  if (value.kind === 'GRID_RATING') {
    await saveGridRating(sessionId, value.constructId, value.elementId, value.rating);
  } else if (value.kind === 'CONSTRUCT_SIMILARITY_VERDICT') {
    await answerSimilarityCheck(sessionId, value.checkId, value.verdict, value.explanation ?? null);
  } else if (value.kind === 'LADDER_STEP') {
    await saveLadderStep(sessionId, value.constructId, value.depth, value.answer);
  } else if (value.kind === 'GRID_COMPLETE') {
    const complete = await isGridComplete(sessionId);
    if (!complete) throw badRequest('Репертуарная решётка заполнена не полностью');
  }

  let revision = 0;
  if (input.questionVersionId) {
    const questionVersion = await prisma.questionVersion.findUnique({
      where: { id: input.questionVersionId },
      select: {
        id: true,
        assessmentVersionId: true,
        subFields: true,
        minLength: true,
        isActive: true,
        question: { select: { type: true } },
      },
    });
    if (!questionVersion) throw notFound('Вопрос не найден');
    if (questionVersion.assessmentVersionId !== session.assessmentVersionId) {
      throw forbidden('Вопрос не принадлежит версии ассессмента этой сессии');
    }
    if (!questionVersion.isActive) throw conflict('Вопрос деактивирован');

    if (input.status === 'SUBMITTED') {
      const definitions = (questionVersion.subFields ?? []) as unknown as SubFieldDefinition[];
      const errors = validateSubFields(value, Array.isArray(definitions) ? definitions : []);
      if (errors.length > 0) {
        throw badRequest('Не все обязательные поля заполнены', errors);
      }
      if (
        value.kind === 'TEXT' &&
        questionVersion.minLength &&
        value.text.trim().length < questionVersion.minLength
      ) {
        throw badRequest(`Ответ требует не менее ${questionVersion.minLength} символов`);
      }
    }

    revision = await persistAnswer(sessionId, questionVersion.id, input, value);

    // Триада порождает персональный конструкт и, возможно, проверку на дубль.
    if (value.kind === 'KELLY_TRIAD' && input.status === 'SUBMITTED') {
      const result = await createConstructFromTriad(sessionId, value);
      if (result.similarityCheck) {
        followUp = {
          kind: 'CONSTRUCT_SIMILARITY_CHECK',
          checkId: result.similarityCheck.id,
          otherConstructId: result.similarityCheck.otherConstructId,
          question: 'Эти критерии для вас означают одно и то же или являются разными?',
        };
      }
    }
  }

  await prisma.testSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });

  const config = await loadPlannerConfig(session.assessmentVersionId);
  const plan = buildPlan(config, (await prisma.testSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { randomSeed: true },
  })).randomSeed);
  const state = await loadPlannerState(sessionId, config);
  const progress = computeProgress(config, state, plan);
  const step = nextStep(config, state, plan);

  await prisma.testSession.update({
    where: { id: sessionId },
    data: {
      progressPercent: progress,
      ...(sectionOf(step) !== 'FINISH' ? { currentSection: sectionOf(step) } : {}),
    },
  });

  return {
    saved: true,
    revision,
    progressPercent: progress,
    followUp,
    nextStep: input.status === 'SUBMITTED' ? step : null,
  };
}

async function persistAnswer(
  sessionId: string,
  questionVersionId: string,
  input: SaveAnswerInput,
  value: AnswerValue,
): Promise<number> {
  const stageIndex = input.stageIndex ?? null;
  const existing = await prisma.answer.findFirst({
    where: { sessionId, questionVersionId, stageIndex },
  });

  const text = extractAnswerText(value);
  const numeric = extractNumericValue(value);
  const telemetry = input.telemetry;

  if (!existing) {
    const created = await prisma.answer.create({
      data: {
        sessionId,
        questionVersionId,
        stageIndex,
        valueJson: value as unknown as Prisma.InputJsonValue,
        textValue: text.length > 0 ? text : null,
        numericValue: numeric,
        status: input.status,
        revisionCount: 0,
        shownAt: telemetry?.shownAt ? new Date(telemetry.shownAt) : null,
        firstInputAt: telemetry?.firstInputAt ? new Date(telemetry.firstInputAt) : null,
        submittedAt: input.status === 'SUBMITTED' ? new Date() : null,
        msActive: telemetry?.msActive ?? 0,
        focusLossCount: telemetry?.focusLossCount ?? 0,
        returnCount: 0,
      },
    });
    await prisma.answerRevision.create({
      data: { answerId: created.id, revision: 0, valueJson: value as unknown as Prisma.InputJsonValue },
    });
    return 0;
  }

  const revision = existing.revisionCount + 1;
  await prisma.$transaction([
    prisma.answer.update({
      where: { id: existing.id },
      data: {
        valueJson: value as unknown as Prisma.InputJsonValue,
        textValue: text.length > 0 ? text : null,
        numericValue: numeric,
        status: input.status === 'SUBMITTED' ? 'SUBMITTED' : existing.status,
        revisionCount: revision,
        submittedAt: input.status === 'SUBMITTED' ? new Date() : existing.submittedAt,
        firstInputAt:
          existing.firstInputAt ?? (telemetry?.firstInputAt ? new Date(telemetry.firstInputAt) : null),
        msActive: existing.msActive + (telemetry?.msActive ?? 0),
        focusLossCount: existing.focusLossCount + (telemetry?.focusLossCount ?? 0),
        returnCount: telemetry?.returned ? existing.returnCount + 1 : existing.returnCount,
      },
    }),
    prisma.answerRevision.create({
      data: { answerId: existing.id, revision, valueJson: value as unknown as Prisma.InputJsonValue },
    }),
  ]);
  return revision;
}

/** Технический журнал сессии (§24). Кадровые выводы на его основании не делаются. */
export async function recordSessionEvent(
  sessionId: string,
  type: string,
  payload?: unknown,
): Promise<void> {
  await prisma.sessionEvent.create({
    data: {
      sessionId,
      type,
      payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface CompleteResult {
  status: 'COMPLETED';
  message: string;
  assessmentStatus: string;
}

/**
 * Завершение сессии. Оценка ставится в очередь; недоступность LLM
 * не влияет на сохранность сессии (§74).
 */
export async function completeSession(sessionId: string, ctx: CandidateCtx): Promise<CompleteResult> {
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, invitationId: true, assessmentVersionId: true, candidateId: true },
  });
  if (!session) throw notFound('Сессия тестирования не найдена');
  if (session.status === 'COMPLETED') {
    return {
      status: 'COMPLETED',
      message: 'Тестирование завершено. Ответы сохранены.',
      assessmentStatus: 'PENDING',
    };
  }

  await prisma.testSession.update({
    where: { id: sessionId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      assessmentStatus: 'PENDING',
      progressPercent: 100,
      currentSection: 'FINISH',
    },
  });

  if (session.invitationId) await markInvitationStatus(session.invitationId, 'COMPLETED');

  await recordAudit({
    action: AUDIT_ACTIONS.SESSION_COMPLETED,
    entity: 'TestSession',
    entityId: sessionId,
    actorKind: 'CANDIDATE',
    actorLabel: session.candidateId,
    ip: ctx.ip ?? null,
    requestId: ctx.requestId ?? null,
  });

  // Постановка в очередь выполняется отложенно, чтобы отказ Redis не мешал
  // завершению сессии: статус PENDING гарантирует обработку позже.
  try {
    const { enqueueSessionAssessment } = await import('../queue/queues.js');
    await enqueueSessionAssessment(sessionId);
  } catch (err) {
    logger.warn({ err, sessionId }, 'не удалось поставить оценку в очередь; статус остаётся PENDING');
  }

  return {
    status: 'COMPLETED',
    message: 'Тестирование завершено. Ответы сохранены.',
    assessmentStatus: 'PENDING',
  };
}

/** Проверка и закрытие сессий с истёкшим сроком (вызывается задачей). */
export async function expireOverdueSessions(): Promise<number> {
  const result = await prisma.testSession.updateMany({
    where: {
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      invitation: { expiresAt: { lte: new Date() } },
    },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

export type { SessionPlan };
