import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, testPrisma } from '../helpers/db.js';
import {
  assertVersionEditable,
  cloneVersion,
  publishVersion,
  updateThresholds,
  updateWeights,
} from '@/server/services/assessmentService.js';
import { ApiError } from '@/server/http/errors.js';

/**
 * Версионирование ассессмента (§32, §36).
 * Ключевой инвариант: опубликованная версия неизменяема.
 */

let adminId: string;

beforeAll(async () => {
  adminId = await ensureUser('version-admin@test.local', 'AssessmentAdmin');
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function draftVersion(): Promise<string> {
  const assessment = await testPrisma.assessment.findFirstOrThrow({
    where: { position: { code: 'MUD_ENGINEER' } },
  });
  const max = await testPrisma.assessmentVersion.aggregate({
    where: { assessmentId: assessment.id },
    _max: { version: true },
  });
  const source = await testPrisma.assessmentVersion.findFirstOrThrow({
    where: { assessmentId: assessment.id, version: 1 },
  });
  const created = await testPrisma.assessmentVersion.create({
    data: {
      assessmentId: assessment.id,
      version: (max._max.version ?? 0) + 1,
      status: 'DRAFT',
      scoringModelId: source.scoringModelId,
      promptTemplateAId: source.promptTemplateAId,
      promptTemplateBId: source.promptTemplateBId,
    },
  });
  // Переносим веса, чтобы версию можно было публиковать.
  const weights = await testPrisma.assessmentCompetency.findMany({
    where: { assessmentVersionId: source.id },
  });
  for (const weight of weights) {
    await testPrisma.assessmentCompetency.create({
      data: {
        assessmentVersionId: created.id,
        competencyId: weight.competencyId,
        weight: weight.weight,
        isHardGate: weight.isHardGate,
        minEvidenceCount: weight.minEvidenceCount,
        minQuestionCount: weight.minQuestionCount,
        orderIndex: weight.orderIndex,
      },
    });
  }
  // И хотя бы один активный вопрос.
  const question = await testPrisma.questionVersion.findFirstOrThrow({
    where: { assessmentVersionId: source.id, isActive: true },
  });
  await testPrisma.questionVersion.create({
    data: {
      questionId: question.questionId,
      assessmentVersionId: created.id,
      section: question.section,
      prompt: question.prompt,
      orderIndex: 0,
      isActive: true,
    },
  });
  return created.id;
}

describe('версионирование ассессмента', () => {
  it('веса черновика изменяются и приводятся к сумме 100', async () => {
    const versionId = await draftVersion();
    const competencies = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });

    const weights = competencies.map((competency, index) => ({
      competencyId: competency.competencyId,
      weight: index === 0 ? 100 - (competencies.length - 1) : 1,
    }));

    await updateWeights(versionId, weights, { userId: adminId });

    const updated = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });
    const sum = updated.reduce((accumulator, item) => accumulator + Number(item.weight), 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('веса с суммой, отличной от 100, отклоняются', async () => {
    const versionId = await draftVersion();
    const competencies = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });
    await expect(
      updateWeights(
        versionId,
        competencies.map((competency) => ({ competencyId: competency.competencyId, weight: 5 })),
        { userId: adminId },
      ),
    ).rejects.toThrow(/сумма весов/i);
  });

  it('изменение весов фиксируется в журнале аудита со старым и новым значением', async () => {
    const versionId = await draftVersion();
    const competencies = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });
    await updateWeights(
      versionId,
      competencies.map((competency, index) => ({
        competencyId: competency.competencyId,
        weight: index === 0 ? 100 - (competencies.length - 1) : 1,
      })),
      { userId: adminId },
    );

    const entry = await testPrisma.auditLog.findFirst({
      where: { entity: 'AssessmentVersion', entityId: versionId, action: 'assessment_version.weights.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.oldValue).toBeTruthy();
    expect(entry?.newValue).toBeTruthy();
    expect(entry?.actorUserId).toBe(adminId);
  });

  it('пороги категорий должны убывать', async () => {
    const versionId = await draftVersion();
    await expect(
      updateThresholds(
        versionId,
        { bandThresholds: { EXPERT: 50, HIGH: 70, SUFFICIENT: 55, GAPS: 40 } },
        { userId: adminId },
      ),
    ).rejects.toThrow(/убыв/i);
  });

  it('опубликованная версия неизменяема', async () => {
    const versionId = await draftVersion();
    await publishVersion(versionId, { userId: adminId });

    const published = await testPrisma.assessmentVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(published.status).toBe('PUBLISHED');
    expect(published.configSnapshot).toBeTruthy();

    await expect(assertVersionEditable(versionId)).rejects.toThrow(/неизменяем/i);

    const competencies = await testPrisma.assessmentCompetency.findMany({
      where: { assessmentVersionId: versionId },
    });
    await expect(
      updateWeights(
        versionId,
        competencies.map((competency, index) => ({
          competencyId: competency.competencyId,
          weight: index === 0 ? 100 - (competencies.length - 1) : 1,
        })),
        { userId: adminId },
      ),
    ).rejects.toMatchObject({ code: 'VERSION_IMMUTABLE' });
  });

  it('повторная публикация отклоняется', async () => {
    const versionId = await draftVersion();
    await publishVersion(versionId, { userId: adminId });
    await expect(publishVersion(versionId, { userId: adminId })).rejects.toBeInstanceOf(ApiError);
  });

  it('клонирование создаёт новый черновик с полным составом', async () => {
    const source = await testPrisma.assessmentVersion.findFirstOrThrow({
      where: { assessment: { position: { code: 'MUD_ENGINEER' } }, version: 1 },
      include: {
        competencies: true,
        kellyTriads: true,
        scenarios: { include: { stages: true } },
        questionVersions: true,
      },
    });

    const cloneId = await cloneVersion(source.id, { userId: adminId });
    const clone = await testPrisma.assessmentVersion.findUniqueOrThrow({
      where: { id: cloneId },
      include: {
        competencies: true,
        kellyElements: true,
        kellyTriads: true,
        scenarios: { include: { stages: true } },
        questionVersions: { include: { competencies: true } },
      },
    });

    expect(clone.status).toBe('DRAFT');
    expect(clone.version).toBeGreaterThan(source.version);
    expect(clone.competencies).toHaveLength(source.competencies.length);
    expect(clone.kellyTriads).toHaveLength(source.kellyTriads.length);
    expect(clone.kellyElements).toHaveLength(10);
    expect(clone.scenarios).toHaveLength(source.scenarios.length);
    expect(clone.questionVersions).toHaveLength(source.questionVersions.length);
    // Связи вопрос → компетенция перенесены.
    expect(clone.questionVersions.some((question) => question.competencies.length > 0)).toBe(true);
    // Этапы кейсов сохранены с сохранением привязки вопросов.
    const clonedStageIds = new Set(clone.scenarios.flatMap((scenario) => scenario.stages.map((s) => s.id)));
    for (const question of clone.questionVersions) {
      if (question.scenarioStageId) expect(clonedStageIds.has(question.scenarioStageId)).toBe(true);
    }
  });

  it('клонирование фиксируется в журнале аудита', async () => {
    const source = await testPrisma.assessmentVersion.findFirstOrThrow({
      where: { assessment: { position: { code: 'IS_ENGINEER' } }, version: 1 },
    });
    const cloneId = await cloneVersion(source.id, { userId: adminId });
    const entry = await testPrisma.auditLog.findFirst({
      where: { entity: 'AssessmentVersion', entityId: cloneId, action: 'assessment_version.cloned' },
    });
    expect(entry).not.toBeNull();
  });
});

describe('инварианты уровня БД', () => {
  it('оценка решётки вне диапазона 1..7 отклоняется базой данных', async () => {
    const position = await testPrisma.position.findFirstOrThrow({ where: { code: 'MUD_ENGINEER' } });
    const version = await testPrisma.assessmentVersion.findFirstOrThrow({
      where: { assessment: { positionId: position.id }, version: 1 },
    });
    const candidate = await testPrisma.candidate.create({
      data: { fullName: 'Проверка ограничений', positionId: position.id },
    });
    const session = await testPrisma.testSession.create({
      data: {
        candidateId: candidate.id,
        assessmentVersionId: version.id,
        randomSeed: 'seed-constraints',
        sectionOrder: {},
      },
    });
    const construct = await testPrisma.candidateConstruct.create({
      data: { sessionId: session.id, poleLeft: 'левый', poleRight: 'правый' },
    });
    const element = await testPrisma.kellyElement.findFirstOrThrow({
      where: { assessmentVersionId: version.id },
    });

    await expect(
      testPrisma.constructRating.create({
        data: { constructId: construct.id, elementId: element.id, rating: 9 },
      }),
    ).rejects.toThrow();

    await testPrisma.candidate.delete({ where: { id: candidate.id } });
  });

  it('глубина лестницы смыслов ограничена базой данных', async () => {
    const position = await testPrisma.position.findFirstOrThrow({ where: { code: 'MUD_ENGINEER' } });
    const version = await testPrisma.assessmentVersion.findFirstOrThrow({
      where: { assessment: { positionId: position.id }, version: 1 },
    });
    const candidate = await testPrisma.candidate.create({
      data: { fullName: 'Проверка лестницы', positionId: position.id },
    });
    const session = await testPrisma.testSession.create({
      data: {
        candidateId: candidate.id,
        assessmentVersionId: version.id,
        randomSeed: 'seed-ladder',
        sectionOrder: {},
      },
    });
    const construct = await testPrisma.candidateConstruct.create({
      data: { sessionId: session.id, poleLeft: 'левый', poleRight: 'правый' },
    });

    await expect(
      testPrisma.ladderStep.create({
        data: { constructId: construct.id, depth: 6, question: 'Почему?', answer: 'потому' },
      }),
    ).rejects.toThrow();

    await testPrisma.candidate.delete({ where: { id: candidate.id } });
  });
});
