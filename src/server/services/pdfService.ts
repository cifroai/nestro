import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';
import { AUDIT_ACTIONS, recordAudit } from './auditService.js';
import { buildReport } from './reportService.js';
import { renderReportHtml } from './reportHtml.js';
import { putObject, reportKey } from './storageService.js';

/**
 * Генерация PDF: печать HTML-отчёта headless Chromium (ADR-9).
 * Один источник вёрстки для web и PDF; кириллица работает за счёт системных
 * шрифтов браузера.
 */

const CHROMIUM_CANDIDATES = [
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

async function resolveExecutablePath(): Promise<string | undefined> {
  const configured = getEnv().CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  const { access, readdir } = await import('node:fs/promises');
  // Каталог сборок Playwright может содержать версионированные подпапки.
  try {
    const entries = await readdir('/opt/pw-browsers');
    for (const entry of entries) {
      const candidate = `/opt/pw-browsers/${entry}/chrome-linux/chrome`;
      try {
        await access(candidate);
        return candidate;
      } catch {
        // следующий кандидат
      }
    }
  } catch {
    // каталог отсутствует — используем стандартные пути ниже
  }
  for (const candidate of CHROMIUM_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // следующий кандидат
    }
  }
  return undefined;
}

export interface PdfResult {
  reportId: string;
  storageKey: string;
  sizeBytes: number;
}

export async function generatePdfReport(
  sessionId: string,
  requestedByUserId: string,
): Promise<PdfResult> {
  const report = await buildReport(sessionId);
  const html = renderReportHtml(report);

  const { chromium } = await import('playwright');
  const executablePath = await resolveExecutablePath();

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let pdf: Buffer;
  try {
    const page = await browser.newPage();
    // Контент задаётся напрямую: страница не обращается к сети,
    // внешние ресурсы не загружаются (снижение поверхности атаки).
    await page.setContent(html, { waitUntil: 'load' });
    pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8pt;color:#647283;padding:0 14mm;' +
        'display:flex;justify-content:space-between;font-family:system-ui">' +
        `<span>${report.candidate.positionTitle}</span>` +
        '<span class="pageNumber"></span></div>',
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }

  const renderedAt = new Date();
  const key = reportKey(sessionId, renderedAt);
  const stored = await putObject(key, pdf, 'application/pdf');

  const record = await prisma.report.create({
    data: {
      sessionId,
      format: 'PDF',
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      renderedAt,
      versionsSnapshot: report.versions as unknown as object,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.REPORT_GENERATED,
    entity: 'Report',
    entityId: record.id,
    actorUserId: requestedByUserId,
    newValue: { sessionId, format: 'PDF', sizeBytes: stored.sizeBytes, versions: report.versions },
  });

  logger.info({ sessionId, reportId: record.id, sizeBytes: stored.sizeBytes }, 'PDF-отчёт сформирован');

  return { reportId: record.id, storageKey: stored.key, sizeBytes: stored.sizeBytes };
}
