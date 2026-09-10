import { PrismaClient } from '@prisma/client';

/**
 * Контроль целостности данных оценки (docs/DEPLOYMENT.md §8.4).
 * Запускается после восстановления из резервной копии и периодически.
 */

const prisma = new PrismaClient();

interface Finding {
  severity: 'ERROR' | 'WARN';
  message: string;
}

async function main(): Promise<void> {
  const findings: Finding[] = [];

  // 1. Сумма весов каждой опубликованной версии должна равняться 100.
  const versions = await prisma.assessmentVersion.findMany({
    where: { status: 'PUBLISHED' },
    include: { competencies: true, assessment: { select: { code: true } } },
  });
  for (const version of versions) {
    const sum = version.competencies.reduce((accumulator, item) => accumulator + Number(item.weight), 0);
    if (Math.abs(sum - 100) > 0.01) {
      findings.push({
        severity: 'ERROR',
        message: `Версия ${version.assessment.code} v${version.version}: сумма весов ${sum.toFixed(2)}, ожидается 100`,
      });
    }
    if (!version.configSnapshot) {
      findings.push({
        severity: 'ERROR',
        message: `Версия ${version.assessment.code} v${version.version}: отсутствует снапшот конфигурации`,
      });
    }
  }

  // 2. У завершённых и оценённых сессий должен быть действующий итоговый балл.
  const scored = await prisma.testSession.findMany({
    where: { status: 'COMPLETED', assessmentStatus: 'DONE' },
    select: {
      id: true,
      finalScores: { where: { supersededById: null, competencyId: null, axis: null }, select: { id: true } },
    },
  });
  for (const session of scored) {
    if (session.finalScores.length !== 1) {
      findings.push({
        severity: 'ERROR',
        message: `Сессия ${session.id}: действующих итоговых баллов ${session.finalScores.length}, ожидается 1`,
      });
    }
  }

  // 3. Маркеры риска от модели обязаны ссылаться на ответ и цитату (§20).
  const orphanFlags = await prisma.riskFlag.count({
    where: { source: 'LLM', OR: [{ answerId: null }, { quote: null }] },
  });
  if (orphanFlags > 0) {
    findings.push({
      severity: 'ERROR',
      message: `Маркеров риска от модели без ссылки на ответ или цитату: ${orphanFlags}`,
    });
  }

  // 4. Согласованность значения «недостаточно данных» (§65).
  const inconsistent = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "LLMDimensionScore"
    WHERE ("score" IS NULL) <> ("notEnoughEvidence" = true)
  `;
  if (Number(inconsistent[0]?.count ?? 0) > 0) {
    findings.push({
      severity: 'ERROR',
      message: `Несогласованных записей score/notEnoughEvidence: ${inconsistent[0]?.count}`,
    });
  }

  // 5. Отложенные оценки — предупреждение (очередь может быть занята).
  const pending = await prisma.testSession.count({
    where: { status: 'COMPLETED', assessmentStatus: { in: ['PENDING', 'FAILED'] } },
  });
  if (pending > 0) {
    findings.push({
      severity: 'WARN',
      message: `Сессий с отложенной автоматической оценкой: ${pending} (обрабатываются worker)`,
    });
  }

  // 6. Экспертные оценки обязаны иметь причину (§29).
  const withoutReason = await prisma.humanReview.count({ where: { reviewReason: '' } });
  if (withoutReason > 0) {
    findings.push({
      severity: 'ERROR',
      message: `Экспертных оценок без причины: ${withoutReason}`,
    });
  }

  // 7. Контрольные счётчики для сверки после восстановления.
  const [sessions, answers, finalScores, auditEntries, candidates] = await Promise.all([
    prisma.testSession.count(),
    prisma.answer.count(),
    prisma.finalScore.count(),
    prisma.auditLog.count(),
    prisma.candidate.count(),
  ]);

  process.stdout.write('Контрольные счётчики:\n');
  process.stdout.write(`  кандидатов: ${candidates}\n`);
  process.stdout.write(`  сессий: ${sessions}\n`);
  process.stdout.write(`  ответов: ${answers}\n`);
  process.stdout.write(`  записей итоговых баллов: ${finalScores}\n`);
  process.stdout.write(`  записей журнала аудита: ${auditEntries}\n\n`);

  if (findings.length === 0) {
    process.stdout.write('Проверка целостности пройдена: нарушений не обнаружено.\n');
    return;
  }

  for (const finding of findings) {
    process.stdout.write(`[${finding.severity}] ${finding.message}\n`);
  }
  if (findings.some((finding) => finding.severity === 'ERROR')) {
    process.exitCode = 1;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    process.stderr.write(`Ошибка проверки целостности: ${String(error)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
