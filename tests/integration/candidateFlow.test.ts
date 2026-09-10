import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, publishedVersionId, resetCandidateData, testPrisma } from '../helpers/db.js';
import { createInvitation } from '@/server/services/invitationService.js';
import {
  completeSession,
  getSessionState,
  saveAnswer,
  startSession,
} from '@/server/services/testSessionService.js';
import { finalizeScoring } from '@/server/services/scoringService.js';
import { buildDrillDown, buildReport } from '@/server/services/reportService.js';
import { submitReview } from '@/server/services/reviewService.js';
import { generateInterviewQuestions } from '@/server/services/interviewQuestionService.js';
import { setProviderOverride } from '@/server/llm/factory.js';
import { FakeProvider } from '@/server/llm/providers/fake.js';
import { evaluateAndStore } from '@/server/services/evaluationService.js';
import { renderReportHtml } from '@/server/services/reportHtml.js';
import type { NextStep } from '@/server/services/sessionPlanner.js';

/**
 * Полный путь кандидата: приглашение → прохождение → завершение →
 * автоматическая оценка → итоги → отчёт → экспертная проверка.
 *
 * Проверяет ключевые acceptance criteria (§79): кандидат проходит тест,
 * прогресс сохраняется, каждый балл имеет доказательства, экспертная
 * проверка выполняется, отчёт формируется.
 */

const LONG = (text: string, min: number): string => {
  let result = text;
  while (result.length < min) result += ` ${text}`;
  return result;
};

const TRIAD_ANSWER = {
  similarity: LONG(
    'Оба заранее замечают развитие ситуации по тенденции параметров и действуют до наступления осложнения',
    60,
  ),
  difference: LONG('Третий начинает действовать только после того, как осложнение уже произошло', 60),
  importanceReason: LONG(
    'Предупреждение осложнения дешевле его ликвидации и снижает риск аварии на скважине',
    60,
  ),
  rigManifestation: LONG(
    'Заранее корректирует параметры промывочной жидкости при росте СНС и снижении выноса шлама',
    60,
  ),
  experienceExample: LONG(
    'На кусте 12 при росте СНС и падении механической скорости мы увеличили расход и включили ротацию, шлам вышел за два цикла',
    120,
  ),
};

const CASE_FIELDS: Record<string, string> = {
  whatHappens: LONG(
    'Растёт крутящий момент при неизменном расходе, что указывает на накопление шлама в наклонном участке',
    90,
  ),
  possibleCauses: LONG(
    'Недостаточный вынос шлама из-за роста механической скорости, локальное осыпание ствола, недостаточная низкоскоростная реология',
    90,
  ),
  missingInformation: LONG('Не хватает данных по фактическому выносу шлама на ситах и профилю ствола', 60),
  checkFirst: LONG('Сначала проверю вынос шлама и профиль ствола в интервале набора угла', 60),
  actions: LONG(
    'Увеличу расход в пределах ограничения по ЭЦП, включу ротацию колонны и скорректирую низкоскоростную реологию',
    90,
  ),
  forbiddenActions: LONG('Нельзя резко повышать расход без оценки ЭЦП и продолжать наращивание при затяжках', 60),
  notify: LONG('Уведомлю бурильщика и супервайзера Заказчика', 30),
  escalationTrigger: LONG(
    'При росте давления более чем на 15 атм или повторной затяжке остановлю операции и уведомлю руководителя проекта',
    60,
  ),
  successCriterion: LONG(
    'Подтверждением служит снижение крутящего момента и стабильный вынос шлама за два цикла циркуляции',
    60,
  ),
};

const CASE_REVISION_FIELDS: Record<string, string> = {
  decisionChange: LONG('Подтверждаю решение, но уточняю порядок действий с учётом новых данных', 60),
  reasoning: LONG(
    'Рост содержания твердой фазы и СНС подтверждает гипотезу о накоплении шлама, а не об осыпании ствола',
    90,
  ),
  actions: LONG(
    'Провожу промывку с вращением, корректирую низкоскоростную реологию и проверяю работу системы очистки',
    90,
  ),
  successCriterion: LONG('Критерий — снижение содержания твердой фазы и восстановление выноса шлама', 60),
};

let hrId: string;
let expertId: string;
let versionId: string;
let sessionId: string;
let candidateId: string;

/** Детерминированный оценщик: строит цитату из фактического текста ответа. */
function fakeEvaluator(): FakeProvider {
  return new FakeProvider((request) => {
    const untrusted = request.messages[request.messages.length - 1]?.content ?? '';
    const start = untrusted.indexOf('<candidate_answer>');
    const end = untrusted.indexOf('</candidate_answer>');
    const answerText =
      start >= 0 && end > start
        ? untrusted.slice(start + '<candidate_answer>'.length, end).trim()
        : '';
    // Цитата — реальный фрагмент ответа: иначе балл будет снят валидатором.
    const quote = answerText.slice(0, 120) || 'нет текста';

    const trusted = request.messages[0]?.content ?? '';
    const competencyLine = /Оцени компетенции: (.+)\./.exec(trusted)?.[1] ?? '';
    const competencies = competencyLine
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);

    return JSON.stringify({
      dimension_scores: competencies.map((code) => ({
        competency_code: code,
        score: 3,
        not_enough_evidence: false,
        explanation: `Кандидат связывает данные, причину, действие и контроль результата по компетенции ${code}.`,
        rubric_rule: 'Уровень 3: данные -> причина -> риск -> решение -> контроль результата',
        confidence: 0.8,
        evidence_quotes: [quote],
      })),
      evidence: [{ quote, comment: 'основание оценки' }],
      missing_evidence: ['не оценена экономика решения'],
      risk_flags: [],
      strengths: [{ quote, comment: 'структурное рассуждение' }],
      ambiguities: [],
      confidence: 0.8,
      review_required: false,
    });
  });
}

beforeAll(async () => {
  await resetCandidateData();
  setProviderOverride(fakeEvaluator());
  hrId = await ensureUser('flow-hr@test.local', 'HR');
  expertId = await ensureUser('flow-expert@test.local', 'TechnicalExpert');
  versionId = await publishedVersionId('MUD_ENGINEER');
});

afterAll(async () => {
  setProviderOverride(null);
  await testPrisma.$disconnect();
});

describe('полный путь кандидата', () => {
  it('приглашение создаётся и выдаёт одноразовую ссылку', async () => {
    const invitation = await createInvitation(
      {
        fullName: 'Петров Пётр Петрович',
        email: 'petrov@example.com',
        positionCode: 'MUD_ENGINEER',
        assessmentVersionId: versionId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        experienceYears: 8,
      },
      { userId: hrId },
    );

    expect(invitation.url).toContain('/invite/');
    candidateId = invitation.candidateId;

    // В БД хранится только хэш токена.
    const stored = await testPrisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const token = invitation.url.split('/invite/')[1] as string;
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toHaveLength(64);

    const started = await startSession(token, { ip: '10.0.0.1' });
    sessionId = started.sessionId;
    expect(started.resumed).toBe(false);

    // Согласие зафиксировано (§44).
    const consent = await testPrisma.consentRecord.count({ where: { candidateId } });
    expect(consent).toBe(1);
  });

  it('сессия привязана к версии ассессмента и начинается с триад', async () => {
    const state = await getSessionState(sessionId);
    expect(state.step.kind).toBe('KELLY_TRIAD');
    expect(state.progressPercent).toBe(0);
    const session = await testPrisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.assessmentVersionId).toBe(versionId);
  });

  it('кандидат проходит все секции: триады, решётка, лестница, кейсы, аргументация, самооценка', async () => {
    let guard = 0;
    let poleIndex = 0;

    for (;;) {
      guard += 1;
      if (guard > 400) throw new Error('Превышено число шагов прохождения');

      const state = await getSessionState(sessionId);
      const step = state.step as NextStep;
      if (step.kind === 'FINISH') break;

      switch (step.kind) {
        case 'KELLY_TRIAD': {
          const payload = state.stepPayload as { elements: Array<{ code: string }> };
          poleIndex += 1;
          await saveAnswer(sessionId, {
            sessionId,
            questionVersionId: step.questionVersionId,
            status: 'SUBMITTED',
            value: {
              kind: 'KELLY_TRIAD',
              triadId: step.triadId,
              similarPair: [payload.elements[0]!.code, payload.elements[1]!.code],
              // Разные формулировки, чтобы конструкты не считались дублями.
              poleLeft: `критерий ${poleIndex} проявляется`,
              poleRight: `критерий ${poleIndex} отсутствует`,
              ...TRIAD_ANSWER,
            },
          });
          break;
        }

        case 'CONSTRUCT_SIMILARITY_CHECK': {
          await saveAnswer(sessionId, {
            sessionId,
            status: 'SUBMITTED',
            value: {
              kind: 'CONSTRUCT_SIMILARITY_VERDICT',
              checkId: step.checkId,
              verdict: 'DIFFERENT',
              explanation: 'Первый критерий про сроки реакции, второй про полноту анализа данных',
            },
          });
          break;
        }

        case 'REPERTORY_GRID': {
          const payload = state.stepPayload as {
            constructs: Array<{ id: string }>;
            elements: Array<{ id: string }>;
          };
          for (const [constructIndex, construct] of payload.constructs.entries()) {
            for (const [elementIndex, element] of payload.elements.entries()) {
              await saveAnswer(sessionId, {
                sessionId,
                status: 'DRAFT',
                value: {
                  kind: 'GRID_RATING',
                  constructId: construct.id,
                  elementId: element.id,
                  // Осмысленный разброс: решётка не должна выглядеть однородной.
                  rating: ((constructIndex + elementIndex) % 7) + 1,
                },
              });
            }
          }
          await saveAnswer(sessionId, {
            sessionId,
            status: 'SUBMITTED',
            value: { kind: 'GRID_COMPLETE' },
          });
          break;
        }

        case 'LADDERING': {
          await saveAnswer(sessionId, {
            sessionId,
            status: 'SUBMITTED',
            value: {
              kind: 'LADDER_STEP',
              constructId: step.constructId,
              depth: step.depth,
              answer: LONG(
                'Это важно, потому что снижает риск осложнения и напрямую влияет на сроки строительства скважины',
                80,
              ),
            },
          });
          break;
        }

        case 'CASE_STAGE': {
          const payload = state.stepPayload as {
            questions: Array<{ id: string; subFields: Array<{ key: string }> | null }>;
          };
          const question = payload.questions[0]!;
          const keys = (question.subFields ?? []).map((field) => field.key);
          const source = keys.includes('decisionChange') ? CASE_REVISION_FIELDS : CASE_FIELDS;
          const fields: Record<string, string> = {};
          for (const key of keys) fields[key] = source[key] ?? LONG('Содержательный ответ по данному пункту', 90);

          await saveAnswer(sessionId, {
            sessionId,
            questionVersionId: question.id,
            stageIndex: step.stageIndex,
            status: 'SUBMITTED',
            value: { kind: 'CASE', fields },
          });
          break;
        }

        case 'QUESTION': {
          const payload = state.stepPayload as {
            question: {
              id: string;
              minLength: number | null;
              options: { items?: Array<{ code: string }> } | null;
              question: { type: string };
            };
          };
          if (payload.question.question.type === 'SELF_RATING') {
            await saveAnswer(sessionId, {
              sessionId,
              questionVersionId: payload.question.id,
              status: 'SUBMITTED',
              value: {
                kind: 'SELF_RATING',
                ratings: (payload.question.options?.items ?? []).map((item) => ({
                  competencyCode: item.code,
                  level: 3,
                  justification: LONG('Обоснование на конкретном примере из практики на кусте 12', 60),
                })),
              },
            });
          } else {
            await saveAnswer(sessionId, {
              sessionId,
              questionVersionId: payload.question.id,
              status: 'SUBMITTED',
              value: {
                kind: 'TEXT',
                text: LONG(
                  'Параметры промывочной жидкости связаны между собой: рост содержания твердой фазы повышает ' +
                    'пластическую вязкость и ухудшает фильтрацию, что влияет на устойчивость ствола и вынос шлама. ' +
                    'Например, при увеличении механической скорости растёт нагрузка на систему очистки, и без ' +
                    'корректировки низкоскоростной реологии ухудшается транспорт шлама в наклонном участке.',
                  payload.question.minLength ?? 300,
                ),
              },
            });
          }
          break;
        }

        default:
          throw new Error(`Неожиданный шаг: ${JSON.stringify(step)}`);
      }
    }

    const state = await getSessionState(sessionId);
    expect(state.step.kind).toBe('FINISH');

    const sections = new Map(state.sections.map((section) => [section.section, section]));
    expect(sections.get('KELLY_TRIADS')!.completed).toBeGreaterThanOrEqual(7);
    expect(sections.get('REPERTORY_GRID')!.completed).toBe(1);
    expect(sections.get('LADDERING')!.completed).toBeGreaterThanOrEqual(3);
    expect(sections.get('SJT_CASES')!.completed).toBe(sections.get('SJT_CASES')!.total);
    expect(sections.get('ARGUMENTATION')!.completed).toBe(sections.get('ARGUMENTATION')!.total);
    expect(sections.get('SELF_RATING')!.completed).toBe(sections.get('SELF_RATING')!.total);
  }, 240_000);

  it('прогресс сохранён на сервере: конструкты, решётка, лестница, ответы', async () => {
    const [constructs, ratings, ladder, answers, revisions] = await Promise.all([
      testPrisma.candidateConstruct.count({ where: { sessionId, isDuplicateOf: null } }),
      testPrisma.constructRating.count({ where: { construct: { sessionId } } }),
      testPrisma.ladderStep.count({ where: { construct: { sessionId } } }),
      testPrisma.answer.count({ where: { sessionId, status: 'SUBMITTED' } }),
      testPrisma.answerRevision.count({ where: { answer: { sessionId } } }),
    ]);

    expect(constructs).toBeGreaterThanOrEqual(7);
    expect(ratings).toBe(constructs * 10);
    expect(ladder).toBeGreaterThanOrEqual(3);
    expect(answers).toBeGreaterThan(20);
    expect(revisions).toBeGreaterThanOrEqual(answers);
  });

  it('завершение сессии не раскрывает кандидату оценку', async () => {
    const result = await completeSession(sessionId, {});
    expect(result.message).toBe('Тестирование завершено. Ответы сохранены.');
    expect(JSON.stringify(result)).not.toMatch(/score|band|risk/i);

    const session = await testPrisma.testSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('COMPLETED');
    // Оценка отложена: недоступность Redis не мешает завершению (§74).
    expect(session.assessmentStatus).toBe('PENDING');
  });

  it('автоматическая оценка сохраняет суждения и подтверждённые доказательства', async () => {
    const answers = await testPrisma.answer.findMany({
      where: {
        sessionId,
        status: 'SUBMITTED',
        textValue: { not: null },
        questionVersion: { competencies: { some: {} } },
      },
      select: { id: true },
    });
    expect(answers.length).toBeGreaterThan(20);

    for (const answer of answers) {
      await evaluateAndStore(answer.id, 'A');
      await evaluateAndStore(answer.id, 'B');
    }

    const runs = await testPrisma.lLMAssessment.count({ where: { answer: { sessionId }, status: 'OK' } });
    expect(runs).toBe(answers.length * 2);

    const verified = await testPrisma.lLMEvidence.count({
      where: { llmAssessment: { answer: { sessionId } }, kind: 'SUPPORTING', verified: true },
    });
    expect(verified).toBeGreaterThan(0);

    const unverifiedShare = await testPrisma.lLMEvidence.count({
      where: { llmAssessment: { answer: { sessionId } }, kind: 'SUPPORTING', verified: false },
    });
    // Цитаты берутся из текста ответа, поэтому непроверенных быть не должно.
    expect(unverifiedShare).toBe(0);
  }, 240_000);

  it('итоговые баллы рассчитаны и содержат покрытие и уверенность', async () => {
    const result = await finalizeScoring(sessionId, { reason: 'INITIAL' });

    expect(result.overall).not.toBeNull();
    expect(result.overall as number).toBeGreaterThan(0);
    expect(result.coverage).toBeGreaterThan(0.6);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.competencyCount).toBe(12);
    expect(['EXPERT', 'HIGH', 'SUFFICIENT', 'GAPS', 'NOT_CONFIRMED']).toContain(result.band);

    const overall = await testPrisma.finalScore.findFirstOrThrow({
      where: { sessionId, competencyId: null, axis: null, supersededAt: null },
    });
    expect(Number(overall.score0to100)).toBeGreaterThan(0);

    const axes = await testPrisma.finalScore.count({
      where: { sessionId, axis: { not: null }, supersededAt: null },
    });
    expect(axes).toBeGreaterThanOrEqual(6);
  });

  it('каждый балл компетенции имеет доказательства (§66)', async () => {
    const scores = await testPrisma.finalScore.findMany({
      where: { sessionId, competencyId: { not: null }, supersededAt: null },
      include: { competency: { select: { code: true } } },
    });

    for (const score of scores) {
      if (score.notEnoughEvidence) continue;
      expect(score.evidenceCount).toBeGreaterThan(0);

      const drill = await buildDrillDown(sessionId, score.competency!.code);
      const quotes = drill.items.flatMap((item) => item.evaluators.flatMap((evaluator) => evaluator.quotes));
      expect(quotes.some((quote) => quote.verified)).toBe(true);
      expect(drill.rubric.length).toBe(5);
    }
  }, 120_000);

  it('отчёт содержит все обязательные разделы и дисклеймеры', async () => {
    const report = await buildReport(sessionId);

    expect(report.candidate.fullName).toBe('Петров Пётр Петрович');
    expect(report.overall.score0to100).not.toBeNull();
    expect(report.competencies.length).toBe(12);
    expect(report.axes.length).toBeGreaterThanOrEqual(6);
    expect(report.constructs.length).toBeGreaterThanOrEqual(7);
    expect(report.grid.rows.length).toBeGreaterThanOrEqual(7);
    expect(report.grid.metrics).not.toBeNull();
    expect(report.grid.metrics?.distances.selfToIdeal).not.toBeNull();
    expect(report.cases.length).toBeGreaterThan(0);
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.versions.scoringModel).toBeTruthy();

    // Обязательные методические оговорки.
    expect(report.disclaimers.purpose).toContain('решение о найме принимает человек');
    expect(report.disclaimers.grid).toContain('не являются психологическим диагнозом');
    expect(report.disclaimers.notEnoughEvidence).toContain('не равно нулю');

    // Кадрового вердикта в отчёте нет.
    const serialized = JSON.stringify(report).toLowerCase();
    expect(serialized).not.toContain('принять на работу');
    expect(serialized).not.toContain('отказать кандидату');
    expect(serialized).not.toContain('психотип');
  });

  it('печатная вёрстка отчёта формируется целиком', async () => {
    const report = await buildReport(sessionId);
    const html = renderReportHtml(report);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Overall Professional Score');
    expect(html).toContain('Репертуарная решётка');
    expect(html).toContain('Рекомендованные вопросы для очного собеседования');
    expect(html).toContain('не содержит кадрового вердикта');
    expect(html.length).toBeGreaterThan(20_000);
  });

  it('вопросы к интервью ссылаются на фактические ответы кандидата (§46)', async () => {
    const result = await generateInterviewQuestions(sessionId);
    expect(result.generated).toBeGreaterThan(0);

    const questions = await testPrisma.interviewQuestion.findMany({ where: { sessionId } });
    const answerIds = new Set(
      (await testPrisma.answer.findMany({ where: { sessionId }, select: { id: true } })).map((a) => a.id),
    );

    for (const question of questions) {
      const refs = question.refAnswerIds as string[];
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(answerIds.has(ref)).toBe(true);
      expect(question.rationale.length).toBeGreaterThan(10);
    }
  }, 60_000);

  it('экспертная оценка перекрывает модельную и сохраняет все три величины', async () => {
    const dimension = await testPrisma.lLMDimensionScore.findFirstOrThrow({
      where: { llmAssessment: { answer: { sessionId }, evaluatorRole: 'A', status: 'OK' } },
      include: { competency: { select: { code: true } } },
    });

    const before = await testPrisma.finalScore.findFirstOrThrow({
      where: { sessionId, competencyId: dimension.competencyId, supersededAt: null },
    });

    const { review } = await submitReview(
      {
        dimensionScoreId: dimension.id,
        humanScore: 1,
        reviewReason: 'Ответ не содержит механизма применения принципа, уровень завышен моделью.',
      },
      { userId: expertId },
    );

    expect(Number(review.modelScore)).toBe(3);
    expect(Number(review.humanScore)).toBe(1);
    expect(Number(review.finalScore)).toBe(1);

    // Итоги пересчитаны, предыдущая запись сохранена как устаревшая (§32).
    const after = await testPrisma.finalScore.findFirstOrThrow({
      where: { sessionId, competencyId: dimension.competencyId, supersededAt: null },
    });
    expect(after.id).not.toBe(before.id);
    expect(Number(after.score0to4)).toBeLessThan(Number(before.score0to4));

    const superseded = await testPrisma.finalScore.findUniqueOrThrow({ where: { id: before.id } });
    expect(superseded.supersededById).toBe(after.id);
    expect(superseded.supersededAt).not.toBeNull();

    // Инвариант: на компетенцию остаётся ровно одна действующая запись.
    const active = await testPrisma.finalScore.count({
      where: { sessionId, competencyId: dimension.competencyId, supersededAt: null },
    });
    expect(active).toBe(1);

    // Запись в журнале аудита присутствует.
    const audit = await testPrisma.auditLog.findFirst({
      where: { entity: 'HumanReview', entityId: review.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(expertId);
  }, 120_000);

  it('drill-down показывает историю ручной корректировки', async () => {
    const review = await testPrisma.humanReview.findFirstOrThrow({
      where: { answer: { sessionId } },
      include: { competency: { select: { code: true } } },
    });
    const drill = await buildDrillDown(sessionId, review.competency.code);
    const withReview = drill.items.filter((item) => item.humanReviews.length > 0);
    expect(withReview.length).toBeGreaterThan(0);
    expect(withReview[0]!.humanReviews[0]!.reviewReason.length).toBeGreaterThan(20);
  });

  it('повторное завершение сессии идемпотентно', async () => {
    const result = await completeSession(sessionId, {});
    expect(result.status).toBe('COMPLETED');
  });

  it('повторный старт по использованному приглашению отклоняется', async () => {
    const invitation = await createInvitation(
      {
        fullName: 'Сидоров Сидор Сидорович',
        positionCode: 'MUD_ENGINEER',
        assessmentVersionId: versionId,
        expiresAt: new Date(Date.now() + 86_400_000),
        maxAttempts: 1,
      },
      { userId: hrId },
    );
    const token = invitation.url.split('/invite/')[1] as string;
    const first = await startSession(token, {});
    await completeSession(first.sessionId, {});
    await expect(startSession(token, {})).rejects.toThrow(/уже завершено/i);
  }, 60_000);
});
