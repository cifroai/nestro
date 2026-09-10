import ExcelJS from 'exceljs';
import { prisma } from '../db/prisma.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import { analyticsSummary, questionStats, type AnalyticsQuery } from './analyticsService.js';
import { buildReport } from './reportService.js';
import { exportCandidateData } from './retentionService.js';
import { listCandidates, type CandidateListQuery } from './candidateService.js';

/**
 * Экспорт (§56): CSV, XLSX, JSON. Объём данных зависит от прав:
 * агрегаты — по analytics:export, полные данные кандидата — по
 * candidate:export_personal. Каждый экспорт фиксируется в журнале аудита.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const CSV_BOM = '﻿';

/** Экранирование значения CSV; разделитель — точка с запятой (локаль ru). */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): Buffer {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((row) => row.map(csvCell).join(';'))];
  return Buffer.from(CSV_BOM + lines.join('\r\n'), 'utf8');
}

export async function toXlsx(
  sheets: Array<{ name: string; headers: string[]; rows: Array<Array<unknown>> }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nestro Assessment Platform';
  workbook.created = new Date();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    worksheet.addRow(sheet.headers);
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row);
    worksheet.columns.forEach((column) => {
      let width = 12;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        width = Math.max(width, Math.min(60, String(cell.value ?? '').length + 2));
      });
      column.width = width;
    });
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const CANDIDATE_HEADERS = [
  'ФИО',
  'Должность',
  'Статус сессии',
  'Статус оценки',
  'Дата завершения',
  'Итоговый балл',
  'Квалификационный уровень',
  'Уверенность',
  'Покрытие данными',
  'Маркеров риска',
  'Требует проверки',
];

function candidateRows(items: Awaited<ReturnType<typeof listCandidates>>['items']): Array<Array<unknown>> {
  return items.map((item) => [
    item.fullName,
    item.positionTitle,
    item.status,
    item.assessmentStatus,
    item.completedAt ? item.completedAt.toISOString() : '',
    item.overall ?? '',
    item.bandTitle ?? '',
    item.confidence ?? '',
    item.coverage ?? '',
    item.riskFlagCount,
    item.reviewRequired ? 'да' : 'нет',
  ]);
}

/** Агрегированный экспорт (право analytics:export). */
export async function exportAggregates(
  format: ExportFormat,
  query: AnalyticsQuery & CandidateListQuery,
  actor: { userId: string; ip?: string | null; requestId?: string | null },
): Promise<ExportFile> {
  const [summary, candidates, questions] = await Promise.all([
    analyticsSummary(query),
    listCandidates({ ...query, pageSize: 200 }),
    questionStats(query.positionCode),
  ]);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');

  await recordAudit({
    action: AUDIT_ACTIONS.ANALYTICS_EXPORTED,
    entity: 'Analytics',
    entityId: null,
    actorUserId: actor.userId,
    newValue: { format, query: { ...query, from: query.from?.toISOString(), to: query.to?.toISOString() } },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  if (format === 'json') {
    return {
      filename: `nestro-analytics-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      body: Buffer.from(
        JSON.stringify({ summary, candidates: candidates.items, questions }, null, 2),
        'utf8',
      ),
    };
  }

  const competencyRows = summary.competencies.map((c) => [
    c.code,
    c.title,
    c.averageScore0to4 ?? '',
    c.averageConfidence,
    c.notEnoughEvidenceShare,
    c.sampleSize,
  ]);
  const questionRows = questions.map((q) => [
    q.questionCode,
    q.section,
    q.completionRate ?? '',
    q.averageScore ?? '',
    q.variance ?? '',
    q.correlationWithTotal ?? '',
    q.humanOverrideRate ?? '',
    q.missingDataFrequency ?? '',
    q.sampleSize,
    q.needsMethodicalReview ? 'требует методической проверки' : '',
    q.reviewReasons.join('; '),
  ]);

  if (format === 'csv') {
    // CSV содержит основную таблицу кандидатов; остальные разделы — в XLSX/JSON.
    return {
      filename: `nestro-candidates-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(CANDIDATE_HEADERS, candidateRows(candidates.items)),
    };
  }

  const body = await toXlsx([
    { name: 'Кандидаты', headers: CANDIDATE_HEADERS, rows: candidateRows(candidates.items) },
    {
      name: 'Компетенции',
      headers: ['Код', 'Компетенция', 'Средний уровень 0-4', 'Средняя уверенность', 'Доля без данных', 'Выборка'],
      rows: competencyRows,
    },
    {
      name: 'Качество вопросов',
      headers: [
        'Код вопроса',
        'Секция',
        'Завершаемость',
        'Средний балл',
        'Дисперсия',
        'Связь с итогом',
        'Частота корректировок',
        'Частота отсутствия данных',
        'Выборка',
        'Отметка',
        'Основания',
      ],
      rows: questionRows,
    },
    {
      name: 'Сводка',
      headers: ['Показатель', 'Значение'],
      rows: [
        ['Приглашений', summary.invitations.total],
        ['Сессий', summary.sessions.total],
        ['Завершено', summary.sessions.completed],
        ['Доля завершения', summary.sessions.completionRate],
        ['Средняя длительность, мин', summary.sessions.averageDurationMinutes ?? ''],
        ['Средний итоговый балл', summary.scores.averageOverall ?? ''],
        ['Медианный итоговый балл', summary.scores.medianOverall ?? ''],
        ['Недостаточно данных, сессий', summary.scores.insufficientData],
        ['Требует экспертной проверки', summary.sessions.reviewRequired],
        ['Среднее расхождение оценщиков', summary.disagreement.averageAbsoluteDelta ?? ''],
        ['Частота экспертных корректировок', summary.disagreement.humanOverrideRate],
      ],
    },
  ]);

  return {
    filename: `nestro-analytics-${stamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body,
  };
}

/** Полный экспорт данных кандидата (право candidate:export_personal). */
export async function exportCandidateFull(
  candidateId: string,
  format: 'json' | 'xlsx',
  actor: { userId: string; ip?: string | null; requestId?: string | null },
): Promise<ExportFile> {
  const data = await exportCandidateData(candidateId);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');

  await recordAudit({
    action: AUDIT_ACTIONS.PII_EXPORTED,
    entity: 'Candidate',
    entityId: candidateId,
    actorUserId: actor.userId,
    newValue: { format, sessions: data.sessions.length },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  if (format === 'json') {
    return {
      filename: `candidate-${candidateId}-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      body: Buffer.from(JSON.stringify(data, null, 2), 'utf8'),
    };
  }

  const answerRows = data.sessions.flatMap((session) =>
    session.answers.map((answer) => [
      session.id,
      answer.questionVersion.question.code,
      answer.questionVersion.prompt.slice(0, 200),
      answer.textValue ?? '',
      answer.status,
      answer.revisionCount,
      answer.submittedAt ? answer.submittedAt.toISOString() : '',
    ]),
  );
  const constructRows = data.sessions.flatMap((session) =>
    session.constructs.map((c) => [
      session.id,
      c.poleLeft,
      c.poleRight,
      c.importanceReason ?? '',
      c.rigManifestation ?? '',
      c.experienceExample ?? '',
      c.importanceRank ?? '',
      c.isDuplicateOf ? 'отмечен как совпадающий' : '',
    ]),
  );
  const scoreRows = data.sessions.flatMap((session) =>
    session.finalScores.map((s) => [
      session.id,
      s.competency?.code ?? (s.axis ?? 'ИТОГ'),
      s.score0to4 === null ? '' : Number(s.score0to4),
      s.score0to100 === null ? '' : Number(s.score0to100),
      s.level ?? '',
      Number(s.confidence),
      s.notEnoughEvidence ? 'недостаточно данных' : '',
      s.band ?? '',
      s.supersededById ? 'устаревшая версия расчёта' : 'действующая',
    ]),
  );

  const body = await toXlsx([
    {
      name: 'Кандидат',
      headers: ['Поле', 'Значение'],
      rows: [
        ['ФИО', data.fullName],
        ['Электронная почта', data.email ?? ''],
        ['Должность', data.position.title],
        ['Стаж, лет', data.experienceYears ?? ''],
        ['Источник', data.sourceChannel ?? ''],
        ['Обезличен', data.anonymizedAt ? data.anonymizedAt.toISOString() : 'нет'],
      ],
    },
    {
      name: 'Ответы',
      headers: ['Сессия', 'Код вопроса', 'Вопрос', 'Ответ', 'Статус', 'Ревизий', 'Отправлен'],
      rows: answerRows,
    },
    {
      name: 'Конструкты',
      headers: ['Сессия', 'Левый полюс', 'Правый полюс', 'Почему важно', 'На буровой', 'Пример', 'Ранг', 'Отметка'],
      rows: constructRows,
    },
    {
      name: 'Оценки',
      headers: ['Сессия', 'Компетенция/Ось', 'Балл 0-4', 'Балл 0-100', 'Уровень', 'Уверенность', 'Отметка', 'Категория', 'Версия расчёта'],
      rows: scoreRows,
    },
  ]);

  return {
    filename: `candidate-${candidateId}-${stamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body,
  };
}

/** Экспорт отчёта в JSON (структура совпадает с web-отчётом). */
export async function exportReportJson(
  sessionId: string,
  actor: { userId: string; ip?: string | null; requestId?: string | null },
): Promise<ExportFile> {
  const report = await buildReport(sessionId);
  await recordAudit({
    action: 'report.exported',
    entity: 'TestSession',
    entityId: sessionId,
    actorUserId: actor.userId,
    newValue: { format: 'json' },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
  return {
    filename: `report-${sessionId}.json`,
    contentType: 'application/json; charset=utf-8',
    body: Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
  };
}

export async function reportFile(reportId: string): Promise<{ storageKey: string; sizeBytes: number | null }> {
  const report = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    select: { storageKey: true, sizeBytes: true },
  });
  return { storageKey: report.storageKey ?? '', sizeBytes: report.sizeBytes };
}
