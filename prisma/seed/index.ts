import { PrismaClient, type Prisma } from '@prisma/client';
import { COMPETENCIES, RUBRICS } from './catalog.js';
import { INTEGRATED_SERVICE_SEED } from './integratedService.js';
import { MUD_ENGINEER_SEED } from './mudEngineer.js';
import { TRIAD_PROMPT, TRIAD_SUBFIELDS } from './kelly.js';
import { PROMPT_TEMPLATES, SCORING_MODEL } from './prompts.js';
import { seedRolesAndPermissions } from './roles.js';
import type { PositionSeed } from './types.js';

const prisma = new PrismaClient();

/**
 * Идемпотентный seed. Новая должность добавляется отдельным PositionSeed —
 * ядро (scoring, Kelly, LLM, отчёт) не меняется (§FR-2.1, docs/ARCHITECTURE.md §8).
 */
const POSITIONS: PositionSeed[] = [MUD_ENGINEER_SEED, INTEGRATED_SERVICE_SEED];

async function seedCatalog(): Promise<void> {
  for (const competency of COMPETENCIES) {
    await prisma.competency.upsert({
      where: { code: competency.code },
      update: { title: competency.title, description: competency.description, axis: competency.axis },
      create: competency,
    });
  }

  for (const rubric of RUBRICS) {
    const competency = await prisma.competency.findUniqueOrThrow({
      where: { code: rubric.competencyCode },
    });
    const code = `RUBRIC_${rubric.competencyCode}`;
    const record = await prisma.rubric.upsert({
      where: { code_version: { code, version: 1 } },
      update: { guidance: rubric.guidance },
      create: { code, version: 1, competencyId: competency.id, guidance: rubric.guidance },
    });
    for (const level of rubric.levels) {
      await prisma.rubricLevel.upsert({
        where: { rubricId_level: { rubricId: record.id, level: level.level } },
        update: {
          descriptor: level.descriptor,
          positiveIndicators: level.positiveIndicators ?? undefined,
          negativeIndicators: level.negativeIndicators ?? undefined,
        },
        create: {
          rubricId: record.id,
          level: level.level,
          descriptor: level.descriptor,
          positiveIndicators: level.positiveIndicators ?? undefined,
          negativeIndicators: level.negativeIndicators ?? undefined,
        },
      });
    }
  }
}

async function seedModelsAndPrompts(): Promise<{ scoringModelId: string; promptAId: string; promptBId: string }> {
  const scoringModel = await prisma.scoringModel.upsert({
    where: { code_version: { code: SCORING_MODEL.code, version: SCORING_MODEL.version } },
    update: { description: SCORING_MODEL.description, params: SCORING_MODEL.params as Prisma.InputJsonValue },
    create: {
      code: SCORING_MODEL.code,
      version: SCORING_MODEL.version,
      description: SCORING_MODEL.description,
      params: SCORING_MODEL.params as Prisma.InputJsonValue,
    },
  });

  const ids = new Map<string, string>();
  for (const template of PROMPT_TEMPLATES) {
    const record = await prisma.promptTemplate.upsert({
      where: { code_version: { code: template.code, version: template.version } },
      update: {
        systemPrompt: template.systemPrompt,
        userTemplate: template.userTemplate,
        jsonSchema: template.jsonSchema as Prisma.InputJsonValue,
        role: template.role,
      },
      create: {
        code: template.code,
        version: template.version,
        role: template.role,
        systemPrompt: template.systemPrompt,
        userTemplate: template.userTemplate,
        jsonSchema: template.jsonSchema as Prisma.InputJsonValue,
      },
    });
    ids.set(template.code, record.id);
  }

  return {
    scoringModelId: scoringModel.id,
    promptAId: ids.get('EVAL_A_CORE') as string,
    promptBId: ids.get('EVAL_B_CORE') as string,
  };
}

/** Создаёт/обновляет вопрос и его версию в рамках версии ассессмента. */
async function upsertQuestion(params: {
  code: string;
  type: Prisma.QuestionCreateInput['type'];
  assessmentVersionId: string;
  section: Prisma.QuestionVersionCreateInput['section'];
  prompt: string;
  helpText?: string | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  options?: unknown;
  subFields?: unknown;
  orderIndex: number;
  difficulty?: number;
  randomizable?: boolean;
  scenarioStageId?: string | undefined;
  rubricId?: string | undefined;
  competencies: Array<{ code: string; weight?: number }>;
}): Promise<string> {
  const question = await prisma.question.upsert({
    where: { code: params.code },
    update: { type: params.type },
    create: { code: params.code, type: params.type },
  });

  const data = {
    section: params.section,
    prompt: params.prompt,
    helpText: params.helpText ?? null,
    minLength: params.minLength ?? null,
    maxLength: params.maxLength ?? null,
    options: (params.options ?? undefined) as Prisma.InputJsonValue | undefined,
    subFields: (params.subFields ?? undefined) as Prisma.InputJsonValue | undefined,
    orderIndex: params.orderIndex,
    difficulty: params.difficulty ?? 2,
    randomizable: params.randomizable ?? false,
    scenarioStageId: params.scenarioStageId ?? null,
    rubricId: params.rubricId ?? null,
  };

  const version = await prisma.questionVersion.upsert({
    where: {
      assessmentVersionId_questionId: {
        assessmentVersionId: params.assessmentVersionId,
        questionId: question.id,
      },
    },
    update: data,
    create: {
      questionId: question.id,
      assessmentVersionId: params.assessmentVersionId,
      ...data,
    },
  });

  // Приводим набор измеряемых компетенций к декларации seed.
  const desired = params.competencies.map((c) => c.code);
  const competencyRecords = await prisma.competency.findMany({ where: { code: { in: desired } } });
  const byCode = new Map(competencyRecords.map((c) => [c.code, c.id]));
  await prisma.questionCompetency.deleteMany({
    where: {
      questionVersionId: version.id,
      competencyId: { notIn: competencyRecords.map((c) => c.id) },
    },
  });
  for (const link of params.competencies) {
    const competencyId = byCode.get(link.code);
    if (!competencyId) throw new Error(`Компетенция ${link.code} отсутствует в каталоге`);
    await prisma.questionCompetency.upsert({
      where: { questionVersionId_competencyId: { questionVersionId: version.id, competencyId } },
      update: { weightWithinCompetency: link.weight ?? 1 },
      create: { questionVersionId: version.id, competencyId, weightWithinCompetency: link.weight ?? 1 },
    });
  }

  return version.id;
}

async function seedPosition(
  seed: PositionSeed,
  models: { scoringModelId: string; promptAId: string; promptBId: string },
): Promise<void> {
  const position = await prisma.position.upsert({
    where: { code: seed.positionCode },
    update: { title: seed.positionTitle, family: seed.family, description: seed.positionDescription },
    create: {
      code: seed.positionCode,
      title: seed.positionTitle,
      family: seed.family,
      description: seed.positionDescription,
    },
  });

  const assessment = await prisma.assessment.upsert({
    where: { code: seed.assessmentCode },
    update: { title: seed.assessmentTitle, positionId: position.id },
    create: { code: seed.assessmentCode, title: seed.assessmentTitle, positionId: position.id },
  });

  // Версия 1: seed поддерживает её в актуальном состоянии, пока она DRAFT.
  // Публикация делает версию неизменяемой; повторный seed её не переписывает.
  const existing = await prisma.assessmentVersion.findUnique({
    where: { assessmentId_version: { assessmentId: assessment.id, version: 1 } },
  });

  if (existing && existing.status !== 'DRAFT') {
    process.stdout.write(
      `Версия 1 ассессмента ${seed.assessmentCode} опубликована — seed её не изменяет.\n`,
    );
    return;
  }

  const version =
    existing ??
    (await prisma.assessmentVersion.create({
      data: {
        assessmentId: assessment.id,
        version: 1,
        status: 'DRAFT',
        notes: 'Базовая версия, созданная seed-скриптом.',
        scoringModelId: models.scoringModelId,
        promptTemplateAId: models.promptAId,
        promptTemplateBId: models.promptBId,
        llmModelPrimary: process.env.LLM_MODEL_PRIMARY ?? null,
        llmModelSecondary: process.env.LLM_MODEL_SECONDARY ?? null,
      },
    }));

  if (existing) {
    await prisma.assessmentVersion.update({
      where: { id: version.id },
      data: {
        scoringModelId: models.scoringModelId,
        promptTemplateAId: models.promptAId,
        promptTemplateBId: models.promptBId,
      },
    });
  }

  // Веса компетенций.
  const competencyRecords = await prisma.competency.findMany();
  const competencyByCode = new Map(competencyRecords.map((c) => [c.code, c.id]));
  const weightSum = seed.weights.reduce((acc, w) => acc + w.weight, 0);
  if (Math.abs(weightSum - 100) > 0.01) {
    throw new Error(`Сумма весов для ${seed.assessmentCode} равна ${weightSum}, ожидается 100`);
  }
  for (const [index, weight] of seed.weights.entries()) {
    const competencyId = competencyByCode.get(weight.competencyCode);
    if (!competencyId) throw new Error(`Компетенция ${weight.competencyCode} отсутствует`);
    await prisma.assessmentCompetency.upsert({
      where: {
        assessmentVersionId_competencyId: { assessmentVersionId: version.id, competencyId },
      },
      update: {
        weight: weight.weight,
        isHardGate: weight.isHardGate ?? false,
        minEvidenceCount: weight.minEvidenceCount ?? 4,
        minQuestionCount: weight.minQuestionCount ?? 3,
        orderIndex: index,
      },
      create: {
        assessmentVersionId: version.id,
        competencyId,
        weight: weight.weight,
        isHardGate: weight.isHardGate ?? false,
        minEvidenceCount: weight.minEvidenceCount ?? 4,
        minQuestionCount: weight.minQuestionCount ?? 3,
        orderIndex: index,
      },
    });
  }

  // Kelly-элементы.
  const elementIds = new Map<string, string>();
  for (const [index, element] of seed.kellyElements.entries()) {
    const record = await prisma.kellyElement.upsert({
      where: { assessmentVersionId_code: { assessmentVersionId: version.id, code: element.code } },
      update: {
        label: element.label,
        description: element.description,
        isSelf: element.isSelf ?? false,
        isIdeal: element.isIdeal ?? false,
        orderIndex: index,
      },
      create: {
        assessmentVersionId: version.id,
        code: element.code,
        label: element.label,
        description: element.description,
        isSelf: element.isSelf ?? false,
        isIdeal: element.isIdeal ?? false,
        orderIndex: index,
      },
    });
    elementIds.set(element.code, record.id);
  }

  // Kelly-триады и вопрос на каждую триаду.
  const lessonsWeight = 0.4;
  for (const [index, triad] of seed.kellyTriads.entries()) {
    const [a, b, c] = triad.elements;
    const ids = [elementIds.get(a), elementIds.get(b), elementIds.get(c)];
    if (ids.some((id) => !id)) throw new Error(`Триада ${triad.code}: неизвестный элемент`);
    await prisma.kellyTriad.upsert({
      where: { assessmentVersionId_code: { assessmentVersionId: version.id, code: triad.code } },
      update: {
        elementAId: ids[0] as string,
        elementBId: ids[1] as string,
        elementCId: ids[2] as string,
        orderIndex: index,
        randomizable: triad.randomizable ?? true,
        isReserve: triad.isReserve ?? false,
      },
      create: {
        assessmentVersionId: version.id,
        code: triad.code,
        elementAId: ids[0] as string,
        elementBId: ids[1] as string,
        elementCId: ids[2] as string,
        orderIndex: index,
        randomizable: triad.randomizable ?? true,
        isReserve: triad.isReserve ?? false,
      },
    });

    await upsertQuestion({
      code: `${seed.positionCode}_KELLY_${triad.code}`,
      type: 'KELLY_TRIAD',
      assessmentVersionId: version.id,
      section: 'KELLY_TRIADS',
      prompt: TRIAD_PROMPT,
      subFields: TRIAD_SUBFIELDS,
      orderIndex: index,
      randomizable: triad.randomizable ?? true,
      // Триады питают ось профессиональной рефлексии; они не доминируют
      // в итоговом балле (docs/SCORING.md §11).
      competencies: [{ code: 'LESSONS', weight: lessonsWeight }],
    });
  }

  // Вопрос заполнения репертуарной решётки.
  await upsertQuestion({
    code: `${seed.positionCode}_GRID`,
    type: 'REPERTORY_GRID',
    assessmentVersionId: version.id,
    section: 'REPERTORY_GRID',
    prompt:
      'Оцените каждого специалиста по сформулированным вами критериям. ' +
      'Шкала показывает, к какому из двух полюсов ближе данный специалист.',
    helpText:
      'Оба полюса критерия отображаются постоянно. Оценка описывает профессиональное ' +
      'поведение специалиста, а не его личные качества.',
    orderIndex: 0,
    competencies: [{ code: 'LESSONS', weight: 0.4 }],
  });

  // Сценарии, этапы и вопросы этапов.
  for (const [scenarioIndex, scenario] of seed.scenarios.entries()) {
    const scenarioRecord = await prisma.scenario.upsert({
      where: { code: scenario.code },
      update: {
        title: scenario.title,
        difficulty: scenario.difficulty,
        equivalenceGroup: scenario.equivalenceGroup ?? null,
        expectedEvidence: scenario.expectedEvidence as Prisma.InputJsonValue,
        unsafeActions: scenario.unsafeActions as Prisma.InputJsonValue,
        expertNotes: scenario.expertNotes,
        orderIndex: scenarioIndex,
        assessmentVersionId: version.id,
        positionId: position.id,
      },
      create: {
        code: scenario.code,
        assessmentVersionId: version.id,
        positionId: position.id,
        title: scenario.title,
        difficulty: scenario.difficulty,
        equivalenceGroup: scenario.equivalenceGroup ?? null,
        expectedEvidence: scenario.expectedEvidence as Prisma.InputJsonValue,
        unsafeActions: scenario.unsafeActions as Prisma.InputJsonValue,
        expertNotes: scenario.expertNotes,
        orderIndex: scenarioIndex,
      },
    });

    for (const [stageIndex, stage] of scenario.stages.entries()) {
      const stageRecord = await prisma.scenarioStage.upsert({
        where: { scenarioId_stageIndex: { scenarioId: scenarioRecord.id, stageIndex } },
        update: {
          situation: stage.situation,
          dynamics: (stage.dynamics ?? undefined) as Prisma.InputJsonValue | undefined,
          constraints: stage.constraints ?? null,
          adjacentServiceInfo: stage.adjacentServiceInfo ?? null,
          revealNote: stage.revealNote ?? null,
        },
        create: {
          scenarioId: scenarioRecord.id,
          stageIndex,
          situation: stage.situation,
          dynamics: (stage.dynamics ?? undefined) as Prisma.InputJsonValue | undefined,
          constraints: stage.constraints ?? null,
          adjacentServiceInfo: stage.adjacentServiceInfo ?? null,
          revealNote: stage.revealNote ?? null,
        },
      });

      for (const [questionIndex, question] of stage.questions.entries()) {
        await upsertQuestion({
          code: question.code,
          type: question.type ?? 'MULTI_STAGE_CASE',
          assessmentVersionId: version.id,
          section: 'SJT_CASES',
          prompt: question.prompt,
          helpText: question.helpText,
          minLength: question.minLength,
          subFields: question.subFields,
          orderIndex: scenarioIndex * 100 + stageIndex * 10 + questionIndex,
          difficulty: scenario.difficulty,
          randomizable: true,
          scenarioStageId: stageRecord.id,
          competencies: question.competencies,
        });
      }
    }
  }

  // Отдельные вопросы: аргументация и самооценка.
  for (const [index, question] of seed.standaloneQuestions.entries()) {
    await upsertQuestion({
      code: question.code,
      type: question.type,
      assessmentVersionId: version.id,
      section: question.section,
      prompt: question.prompt,
      helpText: question.helpText,
      minLength: question.minLength,
      maxLength: question.maxLength,
      options: question.options,
      subFields: question.subFields,
      orderIndex: index,
      competencies: question.competencies,
    });
  }

  process.stdout.write(
    `Должность ${seed.positionCode}: версия 1 обновлена ` +
      `(${seed.scenarios.length} кейсов, ${seed.kellyTriads.length} триад, ` +
      `${seed.weights.length} компетенций).\n`,
  );
}

async function main(): Promise<void> {
  await seedRolesAndPermissions(prisma);
  await seedCatalog();
  const models = await seedModelsAndPrompts();
  for (const position of POSITIONS) {
    await seedPosition(position, models);
  }
  process.stdout.write('Seed завершён.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    process.stderr.write(`Ошибка seed: ${String(err)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
