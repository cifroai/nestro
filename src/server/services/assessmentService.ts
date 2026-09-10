import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { conflict, notFound, versionImmutable, badRequest } from '../http/errors.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';

/**
 * Конструктор ассессментов и версионирование (§32, §33, §36).
 *
 * Инвариант: версия в статусе PUBLISHED неизменяема. Любая правка через API
 * возвращает 409 VERSION_IMMUTABLE. Изменения вносятся в новую DRAFT-версию.
 */

export interface ActorContext {
  userId: string;
  ip?: string | null;
  requestId?: string | null;
}

const WEIGHT_SUM_TOLERANCE = 0.01;

export async function assertVersionEditable(versionId: string): Promise<void> {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: versionId },
    select: { status: true },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');
  if (version.status !== 'DRAFT') {
    throw versionImmutable(
      version.status === 'PUBLISHED'
        ? 'Опубликованная версия ассессмента неизменяема. Создайте новую версию.'
        : 'Архивная версия ассессмента неизменяема.',
    );
  }
}

export async function listAssessments(positionId?: string) {
  return prisma.assessment.findMany({
    where: positionId ? { positionId } : {},
    include: {
      position: true,
      versions: {
        orderBy: { version: 'desc' },
        select: { id: true, version: true, status: true, publishedAt: true, createdAt: true },
      },
    },
    orderBy: { title: 'asc' },
  });
}

export async function getVersionDetail(versionId: string) {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: versionId },
    include: {
      assessment: { include: { position: true } },
      competencies: { include: { competency: true }, orderBy: { orderIndex: 'asc' } },
      kellyElements: { orderBy: { orderIndex: 'asc' } },
      kellyTriads: { orderBy: { orderIndex: 'asc' } },
      scenarios: { include: { stages: { orderBy: { stageIndex: 'asc' } } }, orderBy: { orderIndex: 'asc' } },
      questionVersions: {
        include: { question: true, competencies: { include: { competency: true } } },
        orderBy: [{ section: 'asc' }, { orderIndex: 'asc' }],
      },
      scoringModel: true,
    },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');
  return version;
}

export interface WeightInput {
  competencyId: string;
  weight: number;
  isHardGate?: boolean;
  minEvidenceCount?: number;
  minQuestionCount?: number;
}

/** Изменение весов допустимо только в DRAFT; сумма приводится к 100 (§13, §14). */
export async function updateWeights(
  versionId: string,
  weights: WeightInput[],
  actor: ActorContext,
): Promise<void> {
  await assertVersionEditable(versionId);

  const sum = weights.reduce((acc, w) => acc + w.weight, 0);
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) {
    throw badRequest(`Сумма весов компетенций должна быть равна 100, получено ${sum.toFixed(2)}`);
  }
  if (weights.some((w) => w.weight < 0)) {
    throw badRequest('Вес компетенции не может быть отрицательным');
  }

  const before = await prisma.assessmentCompetency.findMany({
    where: { assessmentVersionId: versionId },
    include: { competency: { select: { code: true } } },
  });

  await prisma.$transaction(async (tx) => {
    for (const [index, w] of weights.entries()) {
      await tx.assessmentCompetency.upsert({
        where: {
          assessmentVersionId_competencyId: {
            assessmentVersionId: versionId,
            competencyId: w.competencyId,
          },
        },
        update: {
          weight: w.weight,
          isHardGate: w.isHardGate ?? false,
          minEvidenceCount: w.minEvidenceCount ?? 4,
          minQuestionCount: w.minQuestionCount ?? 3,
          orderIndex: index,
        },
        create: {
          assessmentVersionId: versionId,
          competencyId: w.competencyId,
          weight: w.weight,
          isHardGate: w.isHardGate ?? false,
          minEvidenceCount: w.minEvidenceCount ?? 4,
          minQuestionCount: w.minQuestionCount ?? 3,
          orderIndex: index,
        },
      });
    }
    await tx.assessmentCompetency.deleteMany({
      where: {
        assessmentVersionId: versionId,
        competencyId: { notIn: weights.map((w) => w.competencyId) },
      },
    });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WEIGHTS_UPDATED,
    entity: 'AssessmentVersion',
    entityId: versionId,
    actorUserId: actor.userId,
    oldValue: before.map((b) => ({
      competency: b.competency.code,
      weight: Number(b.weight),
      isHardGate: b.isHardGate,
    })),
    newValue: weights,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export interface ThresholdInput {
  bandThresholds?: { EXPERT: number; HIGH: number; SUFFICIENT: number; GAPS: number };
  disagreementThreshold?: number;
  gateThreshold?: number;
  minCoverage?: number;
  similarityThreshold?: number;
  ladderConstructCount?: number;
  targetConstructCount?: number;
}

export async function updateThresholds(
  versionId: string,
  input: ThresholdInput,
  actor: ActorContext,
): Promise<void> {
  await assertVersionEditable(versionId);

  if (input.bandThresholds) {
    const t = input.bandThresholds;
    const ordered = t.EXPERT > t.HIGH && t.HIGH > t.SUFFICIENT && t.SUFFICIENT > t.GAPS;
    const bounded = [t.EXPERT, t.HIGH, t.SUFFICIENT, t.GAPS].every((v) => v >= 0 && v <= 100);
    if (!ordered || !bounded) {
      throw badRequest('Пороги категорий должны убывать и находиться в диапазоне 0..100');
    }
  }
  if (input.ladderConstructCount !== undefined && (input.ladderConstructCount < 3 || input.ladderConstructCount > 5)) {
    throw badRequest('Число конструктов для лестницы смыслов допускается от 3 до 5');
  }

  const before = await prisma.assessmentVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      bandThresholds: true,
      disagreementThreshold: true,
      gateThreshold: true,
      minCoverage: true,
      similarityThreshold: true,
      ladderConstructCount: true,
      targetConstructCount: true,
    },
  });

  await prisma.assessmentVersion.update({
    where: { id: versionId },
    data: {
      ...(input.bandThresholds ? { bandThresholds: input.bandThresholds as Prisma.InputJsonValue } : {}),
      ...(input.disagreementThreshold !== undefined
        ? { disagreementThreshold: input.disagreementThreshold }
        : {}),
      ...(input.gateThreshold !== undefined ? { gateThreshold: input.gateThreshold } : {}),
      ...(input.minCoverage !== undefined ? { minCoverage: input.minCoverage } : {}),
      ...(input.similarityThreshold !== undefined ? { similarityThreshold: input.similarityThreshold } : {}),
      ...(input.ladderConstructCount !== undefined
        ? { ladderConstructCount: input.ladderConstructCount }
        : {}),
      ...(input.targetConstructCount !== undefined
        ? { targetConstructCount: input.targetConstructCount }
        : {}),
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.THRESHOLDS_UPDATED,
    entity: 'AssessmentVersion',
    entityId: versionId,
    actorUserId: actor.userId,
    oldValue: before,
    newValue: input,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

/**
 * Публикация версии: фиксирует снапшот конфигурации и делает версию
 * неизменяемой. С этого момента любые изменения — только в новой версии.
 */
export async function publishVersion(versionId: string, actor: ActorContext): Promise<void> {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: versionId },
    include: {
      competencies: { include: { competency: true } },
      questionVersions: { select: { id: true, isActive: true, section: true } },
      assessment: { select: { code: true } },
    },
  });
  if (!version) throw notFound('Версия ассессмента не найдена');
  if (version.status === 'PUBLISHED') throw conflict('Версия уже опубликована');
  if (version.status === 'ARCHIVED') throw versionImmutable('Архивная версия не публикуется повторно');

  const sum = version.competencies.reduce((acc, c) => acc + Number(c.weight), 0);
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) {
    throw badRequest(`Сумма весов компетенций равна ${sum.toFixed(2)}, публикация возможна при 100`);
  }
  const activeQuestions = version.questionVersions.filter((q) => q.isActive);
  if (activeQuestions.length === 0) {
    throw badRequest('Версия не содержит активных вопросов');
  }
  if (!version.scoringModelId) {
    throw badRequest('Версии не назначена модель скоринга');
  }

  const snapshot = {
    publishedAt: new Date().toISOString(),
    assessmentCode: version.assessment.code,
    competencies: version.competencies.map((c) => ({
      code: c.competency.code,
      title: c.competency.title,
      axis: c.competency.axis,
      weight: Number(c.weight),
      isHardGate: c.isHardGate,
      minEvidenceCount: c.minEvidenceCount,
      minQuestionCount: c.minQuestionCount,
    })),
    questionCount: activeQuestions.length,
    sections: [...new Set(activeQuestions.map((q) => q.section))],
    scoringModelId: version.scoringModelId,
    promptTemplateAId: version.promptTemplateAId,
    promptTemplateBId: version.promptTemplateBId,
    bandThresholds: version.bandThresholds,
    disagreementThreshold: Number(version.disagreementThreshold),
    gateThreshold: Number(version.gateThreshold),
    minCoverage: Number(version.minCoverage),
  };

  await prisma.assessmentVersion.update({
    where: { id: versionId },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      publishedByUserId: actor.userId,
      configSnapshot: snapshot as Prisma.InputJsonValue,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VERSION_PUBLISHED,
    entity: 'AssessmentVersion',
    entityId: versionId,
    actorUserId: actor.userId,
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'PUBLISHED', snapshot },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

/**
 * Клонирование версии в новый DRAFT: полный перенос весов, элементов,
 * триад, кейсов и вопросов. Используется для изменения опубликованного теста.
 */
export async function cloneVersion(sourceVersionId: string, actor: ActorContext): Promise<string> {
  const source = await getVersionDetail(sourceVersionId);

  const maxVersion = await prisma.assessmentVersion.aggregate({
    where: { assessmentId: source.assessmentId },
    _max: { version: true },
  });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  const newVersionId = await prisma.$transaction(async (tx) => {
    const created = await tx.assessmentVersion.create({
      data: {
        assessmentId: source.assessmentId,
        version: nextVersion,
        status: 'DRAFT',
        notes: `Клон версии ${source.version}`,
        scoringModelId: source.scoringModelId,
        promptTemplateAId: source.promptTemplateAId,
        promptTemplateBId: source.promptTemplateBId,
        llmModelPrimary: source.llmModelPrimary,
        llmModelSecondary: source.llmModelSecondary,
        disagreementThreshold: source.disagreementThreshold,
        gateThreshold: source.gateThreshold,
        minCoverage: source.minCoverage,
        bandThresholds: source.bandThresholds as Prisma.InputJsonValue,
        ladderConstructCount: source.ladderConstructCount,
        targetConstructCount: source.targetConstructCount,
        similarityThreshold: source.similarityThreshold,
      },
    });

    for (const c of source.competencies) {
      await tx.assessmentCompetency.create({
        data: {
          assessmentVersionId: created.id,
          competencyId: c.competencyId,
          weight: c.weight,
          isHardGate: c.isHardGate,
          minEvidenceCount: c.minEvidenceCount,
          minQuestionCount: c.minQuestionCount,
          orderIndex: c.orderIndex,
        },
      });
    }

    const elementMap = new Map<string, string>();
    for (const e of source.kellyElements) {
      const created2 = await tx.kellyElement.create({
        data: {
          assessmentVersionId: created.id,
          code: e.code,
          label: e.label,
          description: e.description,
          isSelf: e.isSelf,
          isIdeal: e.isIdeal,
          orderIndex: e.orderIndex,
        },
      });
      elementMap.set(e.id, created2.id);
    }

    for (const t of source.kellyTriads) {
      await tx.kellyTriad.create({
        data: {
          assessmentVersionId: created.id,
          code: t.code,
          elementAId: elementMap.get(t.elementAId) as string,
          elementBId: elementMap.get(t.elementBId) as string,
          elementCId: elementMap.get(t.elementCId) as string,
          orderIndex: t.orderIndex,
          randomizable: t.randomizable,
          isReserve: t.isReserve,
        },
      });
    }

    const stageMap = new Map<string, string>();
    for (const s of source.scenarios) {
      const scenario = await tx.scenario.create({
        data: {
          code: `${s.code}_V${nextVersion}`,
          assessmentVersionId: created.id,
          positionId: s.positionId,
          title: s.title,
          difficulty: s.difficulty,
          equivalenceGroup: s.equivalenceGroup,
          expectedEvidence: s.expectedEvidence as Prisma.InputJsonValue,
          unsafeActions: s.unsafeActions as Prisma.InputJsonValue,
          expertNotes: s.expertNotes,
          orderIndex: s.orderIndex,
          isActive: s.isActive,
        },
      });
      for (const stage of s.stages) {
        const createdStage = await tx.scenarioStage.create({
          data: {
            scenarioId: scenario.id,
            stageIndex: stage.stageIndex,
            situation: stage.situation,
            dynamics: stage.dynamics as Prisma.InputJsonValue,
            constraints: stage.constraints,
            adjacentServiceInfo: stage.adjacentServiceInfo,
            revealNote: stage.revealNote,
          },
        });
        stageMap.set(stage.id, createdStage.id);
      }
    }

    for (const qv of source.questionVersions) {
      const createdQv = await tx.questionVersion.create({
        data: {
          questionId: qv.questionId,
          assessmentVersionId: created.id,
          section: qv.section,
          prompt: qv.prompt,
          helpText: qv.helpText,
          subFields: qv.subFields as Prisma.InputJsonValue,
          options: qv.options as Prisma.InputJsonValue,
          required: qv.required,
          minLength: qv.minLength,
          maxLength: qv.maxLength,
          numericUnit: qv.numericUnit,
          numericMin: qv.numericMin,
          numericMax: qv.numericMax,
          difficulty: qv.difficulty,
          orderIndex: qv.orderIndex,
          isActive: qv.isActive,
          randomizable: qv.randomizable,
          scenarioStageId: qv.scenarioStageId ? (stageMap.get(qv.scenarioStageId) ?? null) : null,
          rubricId: qv.rubricId,
        },
      });
      for (const link of qv.competencies) {
        await tx.questionCompetency.create({
          data: {
            questionVersionId: createdQv.id,
            competencyId: link.competencyId,
            weightWithinCompetency: link.weightWithinCompetency,
          },
        });
      }
    }

    return created.id;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VERSION_CLONED,
    entity: 'AssessmentVersion',
    entityId: newVersionId,
    actorUserId: actor.userId,
    newValue: { sourceVersionId, version: nextVersion },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return newVersionId;
}

/** Список версий, доступных для приглашения (только опубликованные). */
export async function listPublishedVersions(positionCode?: string) {
  return prisma.assessmentVersion.findMany({
    where: {
      status: 'PUBLISHED',
      ...(positionCode ? { assessment: { position: { code: positionCode } } } : {}),
    },
    include: { assessment: { include: { position: true } } },
    orderBy: [{ publishedAt: 'desc' }],
  });
}
