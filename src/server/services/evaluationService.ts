import type { EvaluatorRole, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { notFound } from '../http/errors.js';
import { logger } from '../logging/logger.js';
import { createProvider, resolveModels } from '../llm/factory.js';
import { evaluateAnswer, type EvaluationResult } from '../llm/evaluator.js';
import type { PromptContext } from '../llm/promptAssembly.js';
import { LLMUnavailableError } from '../llm/types.js';
import { RISK_FLAG_BY_CODE } from '../scoring/riskFlags.js';

/**
 * Связывает LLM Assessment Engine с БД (docs/LLM_ASSESSMENT.md §5).
 * Задача идемпотентна: повторный запуск для той же пары (ответ, роль)
 * с успешным результатом не выполняет повторный вызов модели.
 */

export interface EvaluateOptions {
  force?: boolean;
}

/** Собирает контекст промпта: вопрос, кейс, rubric и текст ответа. */
async function buildPromptContext(answerId: string): Promise<{
  context: PromptContext;
  competencyCodes: string[];
  competencyIdByCode: Map<string, string>;
  sessionId: string;
  promptTemplateIdA: string | null;
  promptTemplateIdB: string | null;
}> {
  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: {
      session: {
        select: {
          id: true,
          assessmentVersionId: true,
          version: {
            select: {
              promptTemplateAId: true,
              promptTemplateBId: true,
              assessment: { select: { position: { select: { title: true } } } },
            },
          },
        },
      },
      questionVersion: {
        include: {
          question: { select: { code: true, type: true } },
          scenarioStage: {
            include: {
              scenario: { select: { code: true, title: true, expectedEvidence: true } },
            },
          },
          competencies: {
            include: {
              competency: {
                include: {
                  rubrics: {
                    orderBy: { version: 'desc' },
                    take: 1,
                    include: { levels: { orderBy: { level: 'asc' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!answer) throw notFound('Ответ не найден');

  const value = answer.valueJson as Record<string, unknown> | null;
  const subFields =
    value?.kind === 'CASE' && value.fields
      ? Object.entries(value.fields as Record<string, string>).map(([key, text]) => ({
          label: key,
          value: text,
        }))
      : undefined;

  const stage = answer.questionVersion.scenarioStage;
  const scenarioContext = stage
    ? [
        `Кейс: ${stage.scenario.title}`,
        `Этап ${stage.stageIndex + 1}.`,
        stage.situation,
        stage.constraints ? `Ограничения: ${stage.constraints}` : '',
        stage.adjacentServiceInfo ? `Информация от смежных сервисов: ${stage.adjacentServiceInfo}` : '',
        stage.dynamics ? `Динамика параметров: ${JSON.stringify(stage.dynamics)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : null;

  const competencies = answer.questionVersion.competencies.map((link) => ({
    code: link.competency.code,
    title: link.competency.title,
    rubricGuidance: link.competency.rubrics[0]?.guidance ?? link.competency.description ?? '',
    levels:
      link.competency.rubrics[0]?.levels.map((l) => ({ level: l.level, descriptor: l.descriptor })) ?? [],
  }));

  return {
    context: {
      positionTitle: answer.session.version.assessment.position.title,
      questionPrompt: answer.questionVersion.prompt,
      scenarioContext,
      competencies,
      candidateAnswer: answer.textValue ?? '',
      ...(subFields ? { answerSubFields: subFields } : {}),
    },
    competencyCodes: competencies.map((c) => c.code),
    competencyIdByCode: new Map(
      answer.questionVersion.competencies.map((link) => [link.competency.code, link.competencyId]),
    ),
    sessionId: answer.session.id,
    promptTemplateIdA: answer.session.version.promptTemplateAId,
    promptTemplateIdB: answer.session.version.promptTemplateBId,
  };
}

export interface StoredEvaluation {
  status: EvaluationResult['status'];
  dimensionCount: number;
  reviewRequired: boolean;
  skipped: boolean;
}

/**
 * Оценка одного ответа одним оценщиком с сохранением результата.
 * При недоступности провайдера выбрасывает LLMUnavailableError — задача
 * возвращается в очередь, статус сессии остаётся PENDING (§74).
 */
export async function evaluateAndStore(
  answerId: string,
  role: EvaluatorRole,
  options: EvaluateOptions = {},
): Promise<StoredEvaluation> {
  const existing = await prisma.lLMAssessment.findFirst({
    where: { answerId, evaluatorRole: role, status: 'OK' },
    select: { id: true },
  });
  if (existing && !options.force) {
    return { status: 'OK', dimensionCount: 0, reviewRequired: false, skipped: true };
  }

  const provider = createProvider();
  if (!provider.available) throw new LLMUnavailableError();

  const models = resolveModels();
  const model = role === 'A' ? models.primary : (models.secondary ?? models.primary);

  const prepared = await buildPromptContext(answerId);
  if (prepared.context.candidateAnswer.trim().length === 0) {
    // Пустой ответ не отправляется в модель: доказательств не будет по определению.
    await prisma.lLMAssessment.create({
      data: {
        answerId,
        evaluatorRole: role,
        llmProvider: provider.name,
        llmModel: model,
        status: 'SKIPPED',
        errorMessage: 'Ответ не содержит текста для анализа',
        reviewRequired: true,
        attempt: 1,
      },
    });
    return { status: 'OK', dimensionCount: 0, reviewRequired: true, skipped: true };
  }

  const result = await evaluateAnswer(provider, {
    role: role === 'A' ? 'EVAL_A' : 'EVAL_B',
    model,
    promptContext: prepared.context,
    competencyCodes: prepared.competencyCodes,
  });

  const attempt = result.attempts;
  const promptTemplateId = role === 'A' ? prepared.promptTemplateIdA : prepared.promptTemplateIdB;

  await prisma.$transaction(async (tx) => {
    // Прежние прогоны этой роли помечаются как замещённые удалением:
    // история хранится в audit и в rawResponse актуального прогона.
    await tx.lLMAssessment.deleteMany({ where: { answerId, evaluatorRole: role } });

    const run = await tx.lLMAssessment.create({
      data: {
        answerId,
        evaluatorRole: role,
        promptTemplateId,
        llmProvider: provider.name,
        llmModel: model,
        llmModelVersion: result.modelVersion,
        rawResponse: result.rawResponse,
        parsedJson: (result.parsedJson ?? undefined) as Prisma.InputJsonValue | undefined,
        confidence: result.confidence,
        reviewRequired: result.reviewRequired,
        status: result.status,
        errorMessage: result.errorMessage,
        attempt,
        latencyMs: result.latencyMs,
        promptTokens: result.usage.promptTokens ?? null,
        completionTokens: result.usage.completionTokens ?? null,
      },
    });

    for (const dim of result.dimensions) {
      const competencyId = prepared.competencyIdByCode.get(dim.competencyCode);
      if (!competencyId) continue;
      const dimension = await tx.lLMDimensionScore.create({
        data: {
          llmAssessmentId: run.id,
          competencyId,
          score: dim.notEnoughEvidence ? null : dim.score,
          level: dim.notEnoughEvidence ? null : dim.level,
          notEnoughEvidence: dim.notEnoughEvidence,
          explanation: dim.explanation,
          rubricRule: dim.rubricRule,
          confidence: dim.confidence,
        },
      });
      for (const quote of dim.quotes) {
        await tx.lLMEvidence.create({
          data: {
            llmAssessmentId: run.id,
            dimensionScoreId: dimension.id,
            kind: 'SUPPORTING',
            quote: quote.quote,
            verified: quote.verified,
          },
        });
      }
    }

    for (const item of result.evidence) {
      await tx.lLMEvidence.create({
        data: {
          llmAssessmentId: run.id,
          kind: item.kind,
          quote: item.quote ?? item.comment.slice(0, 500),
          comment: item.comment,
          verified: item.verified,
        },
      });
    }

    // Маркеры риска: только с подтверждённой цитатой и известным кодом (§20).
    const answer = await tx.answer.findUniqueOrThrow({
      where: { id: answerId },
      select: { sessionId: true },
    });
    for (const flag of result.riskFlags) {
      if (!RISK_FLAG_BY_CODE.has(flag.code)) continue;
      await tx.riskFlag.create({
        data: {
          sessionId: answer.sessionId,
          answerId,
          code: flag.code,
          severity: flag.severity,
          quote: flag.quote,
          explanation: flag.explanation,
          source: 'LLM',
        },
      });
    }

    if (result.injectionSuspected) {
      await tx.sessionEvent.create({
        data: {
          sessionId: answer.sessionId,
          type: 'SUSPECTED_PROMPT_INJECTION',
          payload: {
            answerId,
            markers: result.injectionMarkers,
            note:
              'Технический признак. Кадровые выводы на этом основании не делаются; ' +
              'ответ помечен для экспертной проверки.',
          } as Prisma.InputJsonValue,
        },
      });
    }
  });

  logger.info(
    { answerId, role, status: result.status, dimensions: result.dimensions.length },
    'ответ оценён',
  );

  return {
    status: result.status,
    dimensionCount: result.dimensions.length,
    reviewRequired: result.reviewRequired,
    skipped: false,
  };
}

/** Ответы сессии, подлежащие автоматической оценке (открытые ответы). */
export async function answersForEvaluation(sessionId: string): Promise<string[]> {
  const answers = await prisma.answer.findMany({
    where: {
      sessionId,
      status: 'SUBMITTED',
      textValue: { not: null },
      questionVersion: {
        question: {
          type: { in: ['LONG_ANSWER', 'SHORT_ANSWER', 'SJT', 'MULTI_STAGE_CASE', 'KELLY_TRIAD', 'SELF_RATING'] },
        },
        competencies: { some: {} },
      },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return answers.map((a) => a.id);
}

/** Все ли ответы сессии обработаны обеими ролями (или помечены пропуском). */
export async function allAnswersEvaluated(sessionId: string, useSecondEvaluator: boolean): Promise<boolean> {
  const answerIds = await answersForEvaluation(sessionId);
  if (answerIds.length === 0) return true;

  const runs = await prisma.lLMAssessment.findMany({
    where: { answerId: { in: answerIds }, status: { in: ['OK', 'INVALID_JSON', 'SKIPPED'] } },
    select: { answerId: true, evaluatorRole: true },
  });

  const byAnswer = new Map<string, Set<string>>();
  for (const run of runs) {
    const set = byAnswer.get(run.answerId) ?? new Set<string>();
    set.add(run.evaluatorRole);
    byAnswer.set(run.answerId, set);
  }

  return answerIds.every((id) => {
    const roles = byAnswer.get(id);
    if (!roles) return false;
    return useSecondEvaluator ? roles.has('A') && roles.has('B') : roles.has('A');
  });
}
