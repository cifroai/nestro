import { PrismaClient } from '@prisma/client';

/**
 * Клиент тестовой БД. Отдельный экземпляр, чтобы тесты не зависели
 * от глобального синглтона приложения.
 */
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        'postgresql://nestro:nestro@127.0.0.1:5432/nestro_test?schema=public',
    },
  },
  log: ['error'],
});

/** Очистка данных кандидатов между тестами; справочники сохраняются. */
export async function resetCandidateData(): Promise<void> {
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE "AnswerRevision", "Answer", "SessionEvent", "LadderStep",
      "ConstructSimilarityCheck", "ConstructRating", "CandidateConstruct",
      "GridAnalysis", "LLMEvidence", "LLMDimensionScore", "LLMAssessment",
      "HumanReview", "FinalScore", "RiskFlag", "Contradiction",
      "InterviewQuestion", "Report", "CandidateSessionToken", "TestSession",
      "Invitation", "ConsentRecord", "EmploymentOutcome", "BenchmarkMember",
      "Candidate"
    RESTART IDENTITY CASCADE
  `);
}

export async function publishedVersionId(positionCode: string): Promise<string> {
  const version = await testPrisma.assessmentVersion.findFirstOrThrow({
    where: { assessment: { position: { code: positionCode } }, version: 1 },
  });
  if (version.status !== 'PUBLISHED') {
    await testPrisma.assessmentVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }
  return version.id;
}

export async function ensureUser(email: string, roleCode: string): Promise<string> {
  const role = await testPrisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await testPrisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName: `Тестовый ${roleCode}`,
      passwordHash: 'placeholder-hash-not-used-in-service-tests',
    },
  });
  await testPrisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  return user.id;
}
