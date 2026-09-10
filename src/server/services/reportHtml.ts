import { BAND_TITLES, LEVEL_TITLES } from '../scoring/engine.js';
import type { ReportView } from './reportService.js';

/**
 * Печатная вёрстка отчёта (§45). Один источник вёрстки используется и для
 * PDF, и для печати из браузера — дублирования шаблонов нет (ADR-9).
 *
 * Стиль корпоративный инженерный: плотные таблицы, моноширинные числа,
 * нейтральная палитра. Красный не используется для оценки человека.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

function dateFmt(value: Date | string | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Горизонтальная шкала уровня 0..4 без цветовой оценки человека. */
function levelBar(score: number | null): string {
  if (score === null) return '<span class="nodata">недостаточно данных</span>';
  const filled = Math.round((score / 4) * 20);
  return `<span class="bar"><span class="bar-fill" style="width:${filled * 5}%"></span></span><span class="bar-value">${fmt(score)}</span>`;
}

function section(title: string, index: number, body: string): string {
  return `<section class="block"><h2><span class="num">${index}.</span> ${esc(title)}</h2>${body}</section>`;
}

function competencyTable(report: ReportView): string {
  const rows = report.competencies
    .map(
      (c) => `<tr>
      <td>${esc(c.competencyTitle)}${c.isHardGate ? ' <span class="tag">критическая</span>' : ''}</td>
      <td class="num-cell">${fmt(c.weight, 1)}%</td>
      <td class="bar-cell">${levelBar(c.score0to4)}</td>
      <td class="num-cell">${c.level === null ? '—' : `${c.level} — ${LEVEL_TITLES[c.level] ?? ''}`}</td>
      <td class="num-cell">${fmt(c.confidence)} (${esc(c.confidenceLabel)})</td>
      <td class="num-cell">${c.evidenceCount}</td>
      <td class="num-cell">${c.questionCount}</td>
      <td>${c.humanReviewed ? 'да' : 'нет'}</td>
    </tr>`,
    )
    .join('');
  return `<table class="grid">
    <thead><tr>
      <th>Компетенция</th><th>Вес</th><th>Уровень 0–4</th><th>Категория уровня</th>
      <th>Уверенность</th><th>Доказательств</th><th>Вопросов</th><th>Проверено экспертом</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function axesTable(report: ReportView): string {
  const titles: Record<string, string> = {
    TECHNICAL_REASONING: 'Техническое мышление',
    SYSTEM_THINKING: 'Системное мышление',
    RISK_MANAGEMENT: 'Управление риском',
    PREVENTIVE_THINKING: 'Превентивное мышление',
    DECISION_MAKING: 'Принятие решений',
    OPERATIONAL_MATURITY: 'Операционная зрелость',
    COMMUNICATION: 'Коммуникация',
    SELF_AWARENESS: 'Профессиональная рефлексия',
  };
  const rows = report.axes
    .map(
      (a) => `<tr>
      <td>${esc(titles[a.axis] ?? a.axis)}</td>
      <td class="bar-cell">${levelBar(a.score0to100 === null ? null : (a.score0to100 / 100) * 4)}</td>
      <td class="num-cell">${a.score0to100 === null ? '—' : fmt(a.score0to100, 1)}</td>
      <td class="num-cell">${a.level === null ? '—' : `${a.level} — ${esc(a.levelTitle ?? '')}`}</td>
      <td class="num-cell">${fmt(a.confidence)}</td>
    </tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr>
      <th>Направление</th><th>Профиль</th><th>Балл 0–100</th><th>Уровень</th><th>Уверенность</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function gridHeatmap(report: ReportView): string {
  if (report.grid.rows.length === 0) return '<p class="nodata">Репертуарная решётка не заполнена.</p>';
  const header = report.grid.elements.map((e) => `<th title="${esc(e.label)}">${esc(e.code)}</th>`).join('');
  const rows = report.grid.rows
    .map((row) => {
      const cells = row.values
        .map((v) => {
          if (v === null) return '<td class="cell empty">—</td>';
          // Насыщенность отражает положение на шкале полюсов, а не «хорошо/плохо».
          const intensity = Math.round(((v - 1) / 6) * 100);
          return `<td class="cell" style="background:rgba(79,70,229,${(intensity / 100) * 0.55})">${v}</td>`;
        })
        .join('');
      return `<tr><td class="pole left">${esc(row.poleLeft)}</td>${cells}<td class="pole right">${esc(row.poleRight)}</td></tr>`;
    })
    .join('');
  return `<table class="grid heatmap"><thead><tr><th>Левый полюс</th>${header}<th>Правый полюс</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">${esc(report.disclaimers.grid)}</p>`;
}

function gapSection(report: ReportView): string {
  const metrics = report.grid.metrics;
  if (!metrics) return '<p class="nodata">Метрики решётки не рассчитаны.</p>';
  const d = metrics.distances;
  const rows = [
    ['«Я сейчас» ↔ «Идеальный инженер»', d.selfToIdeal],
    ['«Я сейчас» ↔ «Один из лучших»', d.selfToBest],
    ['«Я сейчас» ↔ «Не оставил бы самостоятельно»', d.selfToWeak],
  ]
    .map(
      ([label, value]) => `<tr>
      <td>${esc(label as string)}</td>
      <td class="num-cell">${value ? fmt((value as { manhattan: number }).manhattan, 0) : '—'}</td>
      <td class="num-cell">${value ? fmt((value as { manhattanNormalized: number }).manhattanNormalized) : '—'}</td>
      <td class="num-cell">${value ? fmt((value as { euclidean: number }).euclidean) : '—'}</td>
      <td class="num-cell">${value ? (value as { comparedConstructs: number }).comparedConstructs : '—'}</td>
    </tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr>
      <th>Сравнение</th><th>Манхэттен</th><th>Нормировано 0–1</th><th>Евклид</th><th>Конструктов</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <table class="grid compact"><tbody>
      <tr><td>Поляризация оценок</td><td class="num-cell">${pct(metrics.polarization)}</td></tr>
      <tr><td>Доля промежуточных оценок</td><td class="num-cell">${pct(metrics.midpointShare)}</td></tr>
      <tr><td>Кластеров конструктов</td><td class="num-cell">${metrics.clusters.length}</td></tr>
      <tr><td>Потенциально близких пар конструктов</td><td class="num-cell">${metrics.potentialDuplicatePairs.length}</td></tr>
      <tr><td>Показатель внутренней несогласованности</td><td class="num-cell">${pct(metrics.inconsistencyShare)}</td></tr>
      <tr><td>Сигнал профессиональной рефлексии</td><td class="num-cell">${fmt(metrics.reflectionSignal)}</td></tr>
    </tbody></table>
    <p class="note">${esc(report.disclaimers.grid)}</p>`;
}

function constructsSection(report: ReportView): string {
  if (report.constructs.length === 0) return '<p class="nodata">Конструкты не сформированы.</p>';
  return report.constructs
    .map(
      (c) => `<div class="construct">
      <div class="construct-head">
        <strong>${esc(c.poleLeft)}</strong> <span class="arrow">↔</span> <strong>${esc(c.poleRight)}</strong>
        ${c.importanceRank ? `<span class="tag">ранг значимости ${c.importanceRank}</span>` : ''}
        ${c.isDuplicate ? '<span class="tag">отмечен кандидатом как совпадающий</span>' : ''}
      </div>
      ${c.importanceReason ? `<p><span class="label">Почему важно:</span> ${esc(c.importanceReason)}</p>` : ''}
      ${c.rigManifestation ? `<p><span class="label">Как проявляется на буровой:</span> ${esc(c.rigManifestation)}</p>` : ''}
      ${c.experienceExample ? `<p><span class="label">Пример из опыта:</span> ${esc(c.experienceExample)}</p>` : ''}
      ${
        c.ladder.length > 0
          ? `<div class="ladder"><span class="label">Лестница смыслов:</span><ol>${c.ladder
              .map((s) => `<li>${esc(s.answer)}${s.terminalTag ? ` <span class="tag">${esc(s.terminalTag)}</span>` : ''}</li>`)
              .join('')}</ol></div>`
          : ''
      }
    </div>`,
    )
    .join('');
}

function casesSection(report: ReportView): string {
  if (report.cases.length === 0) return '<p class="nodata">Ситуационные кейсы не пройдены.</p>';
  return report.cases
    .map(
      (c) => `<div class="case">
      <h3>${esc(c.scenarioTitle)} <span class="code">${esc(c.scenarioCode)}</span></h3>
      ${c.stages
        .map(
          (stage) => `<div class="stage">
        <div class="stage-title">Этап ${stage.stageIndex + 1}</div>
        <p class="situation">${esc(stage.situation)}</p>
        ${stage.answers
          .map((a) => {
            const value = a.value as { kind?: string; fields?: Record<string, string>; text?: string };
            if (value?.kind === 'CASE' && value.fields) {
              return `<table class="grid compact"><tbody>${Object.entries(value.fields)
                .map(
                  ([key, text]) =>
                    `<tr><td class="field-key">${esc(FIELD_LABELS[key] ?? key)}</td><td>${esc(text)}</td></tr>`,
                )
                .join('')}</tbody></table>`;
            }
            return `<p class="answer">${esc(value?.text ?? JSON.stringify(a.value))}</p>`;
          })
          .join('')}
      </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('');
}

const FIELD_LABELS: Record<string, string> = {
  whatHappens: 'Что происходит',
  possibleCauses: 'Возможные причины',
  missingInformation: 'Какой информации не хватает',
  checkFirst: 'Что проверить первым',
  actions: 'Действия',
  forbiddenActions: 'Что нельзя делать',
  notify: 'Кого уведомить',
  escalationTrigger: 'Когда требуется эскалация',
  successCriterion: 'Критерий подтверждения',
  decisionChange: 'Изменение или подтверждение решения',
  reasoning: 'Что повлияло на вывод',
};

const STYLES = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; font-size: 10.5pt;
         color: #1c2025; margin: 0; line-height: 1.45; }
  h1 { font-size: 17pt; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; margin: 7mm 0 2.5mm; padding-bottom: 1.2mm;
       border-bottom: 1px solid #d5d9df; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 4mm 0 1.5mm; page-break-after: avoid; }
  .num { color: #647283; font-weight: 600; margin-right: 1mm; }
  .head { border-bottom: 2px solid #31363e; padding-bottom: 3mm; margin-bottom: 4mm; }
  .head .meta { color: #4e5a69; font-size: 9.5pt; }
  .summary { display: flex; gap: 6mm; margin: 3mm 0 0; flex-wrap: wrap; }
  .summary .item { border: 1px solid #d5d9df; padding: 2.5mm 3.5mm; min-width: 34mm; }
  .summary .item .k { font-size: 8.5pt; color: #647283; text-transform: uppercase; letter-spacing: .04em; }
  .summary .item .v { font-size: 14pt; font-variant-numeric: tabular-nums; font-weight: 600; }
  .summary .item .s { font-size: 9pt; color: #4e5a69; }
  table.grid { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; font-size: 9.5pt; }
  table.grid th, table.grid td { border: 1px solid #d5d9df; padding: 1.4mm 2mm; text-align: left;
                                 vertical-align: top; }
  table.grid th { background: #f6f7f8; font-weight: 600; font-size: 9pt; }
  table.grid.compact td { padding: 1.1mm 2mm; }
  .num-cell { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .field-key { width: 46mm; color: #4e5a69; }
  .bar { display: inline-block; width: 26mm; height: 2.6mm; background: #eceef1; vertical-align: middle;
         margin-right: 1.6mm; }
  .bar-fill { display: block; height: 100%; background: #4f46e5; }
  .bar-value { font-variant-numeric: tabular-nums; font-size: 9pt; }
  .bar-cell { white-space: nowrap; }
  .nodata { color: #647283; font-style: italic; }
  .tag { display: inline-block; border: 1px solid #b0b8c2; padding: 0 1.4mm; font-size: 8pt;
         color: #404955; border-radius: 2px; margin-left: 1.5mm; white-space: nowrap; }
  .note { font-size: 8.8pt; color: #4e5a69; border-left: 2px solid #b0b8c2; padding-left: 2.5mm;
          margin: 2mm 0; }
  .warn { border-left-color: #d97706; }
  .block { page-break-inside: avoid; }
  .construct { border: 1px solid #d5d9df; padding: 2.5mm 3mm; margin-bottom: 2.5mm;
               page-break-inside: avoid; }
  .construct-head { margin-bottom: 1.5mm; }
  .arrow { color: #647283; margin: 0 1mm; }
  .label { color: #4e5a69; font-weight: 600; }
  .ladder ol { margin: 1mm 0 0 5mm; padding: 0; }
  .case { margin-bottom: 4mm; }
  .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.5pt; color: #647283; }
  .stage { margin: 2mm 0 3mm; }
  .stage-title { font-weight: 600; font-size: 9.5pt; color: #404955; }
  .situation { font-size: 9.2pt; color: #404955; background: #f6f7f8; padding: 2mm; margin: 1mm 0 2mm; }
  .answer { white-space: pre-wrap; }
  .quote { font-style: italic; color: #31363e; }
  .heatmap td.cell { text-align: center; font-variant-numeric: tabular-nums; width: 7mm; }
  .heatmap td.pole { font-size: 8.8pt; width: 32mm; }
  .heatmap td.empty { color: #b0b8c2; }
  ol.questions li { margin-bottom: 2mm; }
  .footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #d5d9df; font-size: 8.5pt;
            color: #647283; }
`;

/** Полный самодостаточный HTML отчёта. */
export function renderReportHtml(report: ReportView): string {
  const o = report.overall;
  let index = 0;
  const next = (): number => (index += 1);

  const body = [
    section(
      'Общая информация',
      next(),
      `<table class="grid compact"><tbody>
        <tr><td>Кандидат</td><td>${esc(report.candidate.fullName)}</td></tr>
        <tr><td>Должность</td><td>${esc(report.candidate.positionTitle)}</td></tr>
        <tr><td>Стаж, лет</td><td>${report.candidate.experienceYears ?? '—'}</td></tr>
        <tr><td>Ассессмент</td><td>${esc(report.session.assessmentTitle)}, версия ${report.session.assessmentVersion}</td></tr>
        <tr><td>Начало / завершение</td><td>${dateFmt(report.session.startedAt)} — ${dateFmt(report.session.completedAt)}</td></tr>
        <tr><td>Длительность, мин</td><td class="num-cell">${report.session.durationMinutes ?? '—'}</td></tr>
        <tr><td>Модель скоринга</td><td>${esc(report.versions.scoringModel ?? '—')}</td></tr>
        <tr><td>Версия движка решётки</td><td>${esc(report.versions.gridEngineVersion ?? '—')}</td></tr>
        <tr><td>Модели оценки</td><td>${esc(report.versions.llmModels.join(', ') || '—')}</td></tr>
        <tr><td>Шаблоны промптов</td><td>${esc(report.versions.promptTemplates.join(', ') || '—')}</td></tr>
      </tbody></table>
      <p class="note">${esc(report.disclaimers.protectedAttributes)}</p>`,
    ),

    section(
      'Overall Professional Score',
      next(),
      `<div class="summary">
        <div class="item"><div class="k">Итоговый балл</div>
          <div class="v">${o.score0to100 === null ? '—' : fmt(o.score0to100, 1)}</div>
          <div class="s">из 100</div></div>
        <div class="item"><div class="k">Квалификационный уровень</div>
          <div class="v" style="font-size:11pt">${esc(o.bandTitle)}</div>
          <div class="s">${esc(o.band ?? '')}</div></div>
        <div class="item"><div class="k">Покрытие данными</div>
          <div class="v">${pct(o.coverage)}</div>
          <div class="s">веса компетенций с данными</div></div>
      </div>
      ${o.insufficientData ? `<p class="note warn">Недостаточно данных: покрытие ниже минимального порога. Итоговый балл приведён как справочная величина.</p>` : ''}
      <p class="note">${esc(report.disclaimers.purpose)}</p>`,
    ),

    section(
      'Уровень уверенности',
      next(),
      `<table class="grid compact"><tbody>
        <tr><td>Уверенность итогового вывода</td><td class="num-cell">${fmt(o.confidence)} — ${esc(o.confidenceLabel)}</td></tr>
        <tr><td>Требуется экспертная проверка</td><td>${report.session.reviewRequired ? 'да' : 'нет'}</td></tr>
        <tr><td>Экспертная проверка завершена</td><td>${report.session.reviewCompletedAt ? dateFmt(report.session.reviewCompletedAt) : 'нет'}</td></tr>
      </tbody></table>
      <p class="note">${esc(report.disclaimers.confidence)}</p>`,
    ),

    section('Карта компетенций', next(), `${axesTable(report)}${competencyTable(report)}
      <p class="note">${esc(report.disclaimers.notEnoughEvidence)}</p>`),

    section(
      'Сильные стороны',
      next(),
      report.strengths.length === 0
        ? '<p class="nodata">Подтверждённых цитатами сильных сторон не зафиксировано.</p>'
        : `<table class="grid"><thead><tr><th>Компетенция</th><th>Цитата из ответа</th><th>Комментарий</th></tr></thead>
           <tbody>${report.strengths
             .map(
               (s) => `<tr><td>${esc(s.competencyCode)}</td>
             <td class="quote">«${esc(s.quote)}»</td><td>${esc(s.comment)}</td></tr>`,
             )
             .join('')}</tbody></table>`,
    ),

    section(
      'Компетенции, требующие дополнительной проверки',
      next(),
      report.toVerify.length === 0
        ? '<p class="nodata">Не выявлено.</p>'
        : `<table class="grid"><thead><tr><th>Компетенция</th><th>Основание</th><th>Уровень 0–4</th></tr></thead>
           <tbody>${report.toVerify
             .map(
               (t) => `<tr><td>${esc(t.competencyTitle)}</td><td>${esc(t.reason)}</td>
             <td class="num-cell">${fmt(t.score)}</td></tr>`,
             )
             .join('')}</tbody></table>
           ${
             report.criticalGaps.length > 0
               ? `<h3>Критические компетенции</h3><table class="grid"><thead><tr>
                  <th>Компетенция</th><th>Статус</th><th>Уровень</th></tr></thead><tbody>${report.criticalGaps
                    .map(
                      (g) => `<tr><td>${esc(g.competencyCode)}</td><td>${esc(g.message)}</td>
                    <td class="num-cell">${fmt(g.score0to4)}</td></tr>`,
                    )
                    .join('')}</tbody></table>
                  <p class="note">${esc(report.disclaimers.hardGate)}</p>`
               : ''
           }`,
    ),

    section(
      'Профессиональные маркеры риска',
      next(),
      report.riskFlags.filter((f) => !f.dismissed).length === 0
        ? '<p class="nodata">Маркеры риска не зафиксированы.</p>'
        : `<table class="grid"><thead><tr><th>Маркер</th><th>Значимость</th><th>Источник</th>
             <th>Цитата / основание</th><th>Пояснение</th></tr></thead><tbody>${report.riskFlags
               .filter((f) => !f.dismissed)
               .map(
                 (f) => `<tr><td>${esc(f.title)}</td><td>${esc(f.severity)}</td><td>${esc(f.source)}</td>
               <td class="quote">${f.quote ? `«${esc(f.quote)}»` : '—'}</td><td>${esc(f.explanation)}</td></tr>`,
               )
               .join('')}</tbody></table>`,
    ),

    section('Персональные профессиональные конструкты', next(), constructsSection(report)),

    section('Репертуарная решётка', next(), gridHeatmap(report)),

    section('Расхождение «Я сейчас» / «Идеальный инженер»', next(), gapSection(report)),

    section('Анализ ситуационных кейсов', next(), casesSection(report)),

    section(
      'Расхождения между декларациями и решениями',
      next(),
      report.contradictions.length === 0
        ? '<p class="nodata">Расхождений не выявлено.</p>'
        : `<table class="grid"><thead><tr><th>Наблюдение</th><th>Сила</th></tr></thead><tbody>${report.contradictions
            .map(
              (c) => `<tr><td>${esc(c.description)}</td><td class="num-cell">${fmt(c.strength)}</td></tr>`,
            )
            .join('')}</tbody></table>
          <p class="note">${esc(report.disclaimers.contradiction)}</p>`,
    ),

    section(
      'Доказательства',
      next(),
      report.evidence.length === 0
        ? '<p class="nodata">Доказательства отсутствуют.</p>'
        : `<table class="grid"><thead><tr><th>Компетенция</th><th>Тип</th><th>Цитата</th>
             <th>Комментарий</th><th>Проверено</th></tr></thead><tbody>${report.evidence
               .slice(0, 200)
               .map(
                 (e) => `<tr><td>${esc(e.competencyCode || '—')}</td><td>${esc(e.kind)}</td>
               <td class="quote">${e.quote ? `«${esc(e.quote)}»` : '—'}</td>
               <td>${esc(e.comment ?? '')}</td><td>${e.verified ? 'да' : 'нет'}</td></tr>`,
               )
               .join('')}</tbody></table>`,
    ),

    section(
      'Рекомендованные вопросы для очного собеседования',
      next(),
      report.interviewQuestions.length === 0
        ? '<p class="nodata">Вопросы не сформированы.</p>'
        : `<ol class="questions">${report.interviewQuestions
            .map(
              (q) => `<li><div>${esc(q.text)}</div>
            <div class="note">Основание: ${esc(q.rationale)}${
              q.competencyCode ? ` · компетенция ${esc(q.competencyCode)}` : ''
            } · ответов-источников: ${q.refAnswerIds.length}</div></li>`,
            )
            .join('')}</ol>`,
    ),

    section(
      'Заключение технического эксперта',
      next(),
      report.expertConclusion.length === 0
        ? '<p class="nodata">Экспертная проверка не выполнялась.</p>'
        : `<table class="grid"><thead><tr><th>Компетенция</th><th>Модель</th><th>Эксперт</th>
             <th>Итог</th><th>Причина изменения</th><th>Эксперт</th><th>Дата</th></tr></thead>
           <tbody>${report.expertConclusion
             .map(
               (r) => `<tr><td>${esc(r.competencyCode)}</td><td class="num-cell">${fmt(r.modelScore)}</td>
             <td class="num-cell">${fmt(r.humanScore)}</td><td class="num-cell">${fmt(r.finalScore)}</td>
             <td>${esc(r.reviewReason)}</td><td>${esc(r.reviewerName)}</td><td>${dateFmt(r.createdAt)}</td></tr>`,
             )
             .join('')}</tbody></table>`,
    ),
  ].join('');

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Отчёт по оценке — ${esc(report.candidate.fullName)}</title>
<style>${STYLES}</style></head>
<body>
  <div class="head">
    <h1>Отчёт по профессиональной оценке кандидата</h1>
    <div class="meta">${esc(report.candidate.fullName)} · ${esc(report.candidate.positionTitle)} ·
      сформирован ${dateFmt(new Date())} · сессия ${esc(report.session.id)}</div>
  </div>
  ${body}
  <div class="footer">
    Документ является системой поддержки решения и не содержит кадрового вердикта.
    Квалификационные категории: ${Object.entries(BAND_TITLES)
      .map(([code, title]) => `${esc(code)} — ${esc(title)}`)
      .join('; ')}.
  </div>
</body></html>`;
}
