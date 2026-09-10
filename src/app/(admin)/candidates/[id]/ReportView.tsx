'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../../../lib/api.js';
import {
  Button,
  Card,
  ChartWithTable,
  DefinitionList,
  EmptyState,
  LevelIndicator,
  Notice,
  Spinner,
  Table,
  Tag,
  Td,
  TechError,
} from '../../../../components/ui/index.js';
import { GridHeatmap, RadarChart } from '../../../../components/charts/index.js';
import {
  AXIS_LABELS,
  LEVEL_LABELS,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from '../../../../lib/format.js';
import { ReviewPanel } from './ReviewPanel.js';

/**
 * Карточка кандидата (§27) с обязательным drill-down (§28).
 * Любой балл раскрывается до вопросов, ответов, цитат, оценок каждого
 * оценщика, применённой rubric и истории ручных корректировок.
 */

export interface ReportData {
  candidate: {
    id: string;
    fullName: string;
    positionTitle: string;
    positionCode: string;
    experienceYears: number | null;
    anonymized: boolean;
  };
  session: {
    id: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMinutes: number | null;
    assessmentTitle: string;
    assessmentVersion: number;
    assessmentStatus: string;
    reviewRequired: boolean;
    reviewCompletedAt: string | null;
  };
  overall: {
    score0to100: number | null;
    band: string | null;
    bandTitle: string;
    confidence: number;
    confidenceLabel: string;
    coverage: number | null;
    insufficientData: boolean;
  };
  axes: Array<{
    axis: string;
    score0to100: number | null;
    level: number | null;
    levelTitle: string | null;
    confidence: number;
    notEnoughEvidence: boolean;
  }>;
  competencies: Array<{
    competencyCode: string;
    competencyTitle: string;
    axis: string;
    weight: number;
    score0to4: number | null;
    score0to100: number | null;
    level: number | null;
    levelTitle: string | null;
    confidence: number;
    confidenceLabel: string;
    evidenceCount: number;
    questionCount: number;
    notEnoughEvidence: boolean;
    isHardGate: boolean;
    humanReviewed: boolean;
  }>;
  strengths: Array<{ competencyCode: string; quote: string; comment: string; answerId: string }>;
  toVerify: Array<{ competencyCode: string; competencyTitle: string; reason: string; score: number | null }>;
  criticalGaps: Array<{ competencyCode: string; message: string; reason: string; score0to4: number | null }>;
  riskFlags: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    quote: string | null;
    explanation: string;
    source: string;
    answerId: string | null;
    confirmed: boolean;
    dismissed: boolean;
  }>;
  constructs: Array<{
    id: string;
    poleLeft: string;
    poleRight: string;
    importanceReason: string | null;
    rigManifestation: string | null;
    experienceExample: string | null;
    importanceRank: number | null;
    isDuplicate: boolean;
    ladder: Array<{ depth: number; question: string; answer: string; terminalTag: string | null }>;
  }>;
  grid: {
    metrics: {
      disclaimer: string;
      selfIdealGap: number | null;
      reflectionSignal: number | null;
      polarization: number;
      midpointShare: number;
      inconsistencyShare: number;
      clusters: Array<{ members: string[]; averageAbsCorrelation: number }>;
      potentialDuplicatePairs: Array<{ constructAId: string; constructBId: string; correlation: number | null }>;
      distances: {
        selfToIdeal: { manhattan: number; manhattanNormalized: number; euclidean: number; comparedConstructs: number } | null;
        selfToBest: { manhattan: number; manhattanNormalized: number; euclidean: number; comparedConstructs: number } | null;
        selfToWeak: { manhattan: number; manhattanNormalized: number; euclidean: number; comparedConstructs: number } | null;
      };
      distribution: Record<string, number>;
    } | null;
    elements: Array<{ code: string; label: string }>;
    rows: Array<{ constructId: string; poleLeft: string; poleRight: string; values: Array<number | null> }>;
  };
  cases: Array<{
    scenarioCode: string;
    scenarioTitle: string;
    stages: Array<{
      stageIndex: number;
      situation: string;
      answers: Array<{ answerId: string; value: unknown; submittedAt: string | null }>;
    }>;
  }>;
  contradictions: Array<{ description: string; strength: number; answerIds: string[] }>;
  evidence: Array<{
    competencyCode: string;
    kind: string;
    quote: string | null;
    comment: string | null;
    answerId: string;
    verified: boolean;
  }>;
  interviewQuestions: Array<{
    text: string;
    rationale: string;
    competencyCode: string | null;
    refAnswerIds: string[];
  }>;
  expertConclusion: Array<{
    competencyCode: string;
    modelScore: number | null;
    humanScore: number | null;
    finalScore: number | null;
    reviewReason: string;
    reviewerName: string;
    createdAt: string;
  }>;
  versions: {
    assessmentVersion: number;
    scoringModel: string | null;
    gridEngineVersion: string | null;
    llmModels: string[];
    promptTemplates: string[];
  };
  disclaimers: Record<string, string>;
}

interface DrillDown {
  competencyCode: string;
  competencyTitle: string;
  rubric: Array<{ level: number; descriptor: string }>;
  finalScore: { score0to4: number | null; level: number | null; confidence: number; notEnoughEvidence: boolean } | null;
  items: Array<{
    answerId: string;
    questionCode: string;
    questionPrompt: string;
    answerValue: unknown;
    scenario: { code: string; title: string; stageIndex: number } | null;
    evaluators: Array<{
      role: string;
      score: number | null;
      notEnoughEvidence: boolean;
      confidence: number;
      explanation: string;
      rubricRule: string;
      model: string;
      provider: string;
      quotes: Array<{ quote: string; verified: boolean; kind: string }>;
    }>;
    humanReviews: Array<{
      modelScore: number | null;
      humanScore: number | null;
      finalScore: number | null;
      reviewReason: string;
      markedUninformative: boolean;
      reviewerName: string;
      createdAt: string;
    }>;
  }>;
}

export function ReportView({ candidateId, canReview }: { candidateId: string; canReview: boolean }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const [drillBusy, setDrillBusy] = useState(false);
  const [pdfState, setPdfState] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await api.get<ReportData>(`/api/candidates/${candidateId}/report`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось загрузить отчёт');
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDrill = useCallback(
    async (competencyCode: string) => {
      setDrillBusy(true);
      try {
        setDrill(
          await api.get<DrillDown>(
            `/api/candidates/${candidateId}/report/drilldown?competencyCode=${encodeURIComponent(competencyCode)}`,
          ),
        );
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Не удалось загрузить детализацию');
      } finally {
        setDrillBusy(false);
      }
    },
    [candidateId],
  );

  if (error && !report) return <TechError>{error}</TechError>;
  if (!report) return <Spinner label="Загрузка отчёта" />;

  const axisData = report.axes.map((axis) => ({
    label: AXIS_LABELS[axis.axis] ?? axis.axis,
    value: axis.score0to100 === null ? null : (axis.score0to100 / 100) * 4,
  }));

  return (
    <div className="space-y-5">
      {error && <TechError>{error}</TechError>}

      {/* Верх карточки (§27). */}
      <Card
        title={report.candidate.fullName}
        subtitle={`${report.candidate.positionTitle} · ${report.session.assessmentTitle}, версия ${report.session.assessmentVersion}`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                setPdfState('Формирование…');
                try {
                  await api.post(`/api/candidates/${candidateId}/report/pdf`);
                  setPdfState('PDF-отчёт формируется. Он появится в списке отчётов кандидата.');
                } catch (err) {
                  setPdfState(err instanceof ApiRequestError ? err.message : 'Ошибка формирования PDF');
                }
              }}
            >
              Сформировать PDF
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Печать
            </Button>
          </div>
        }
      >
        {pdfState && <Notice tone="info">{pdfState}</Notice>}
        <div className="grid gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          <div className="rounded border border-graphite-200 px-3 py-2.5">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">Overall Professional Score</div>
            <div className="tnum mt-1 text-3xl font-semibold text-graphite-900">
              {report.overall.score0to100 === null ? '—' : formatNumber(report.overall.score0to100, 1)}
            </div>
            <div className="text-2xs text-graphite-500">из 100</div>
          </div>
          <div className="rounded border border-graphite-200 px-3 py-2.5">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">Квалификационный уровень</div>
            <div className="mt-1 text-sm font-medium text-graphite-900">{report.overall.bandTitle}</div>
            {report.overall.band && <div className="mt-0.5 text-2xs text-graphite-400">{report.overall.band}</div>}
          </div>
          <div className="rounded border border-graphite-200 px-3 py-2.5">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">Уровень уверенности</div>
            <div className="tnum mt-1 text-2xl font-semibold text-graphite-900">
              {formatNumber(report.overall.confidence)}
            </div>
            <div className="text-2xs text-graphite-500">{report.overall.confidenceLabel}</div>
          </div>
          <div className="rounded border border-graphite-200 px-3 py-2.5">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">Покрытие данными</div>
            <div className="tnum mt-1 text-2xl font-semibold text-graphite-900">
              {formatPercent(report.overall.coverage)}
            </div>
            <div className="text-2xs text-graphite-500">веса компетенций с данными</div>
          </div>
        </div>

        {report.overall.insufficientData && (
          <Notice tone="tech" title="Недостаточно данных">
            Покрытие данными ниже минимального порога. Итоговый балл приведён как справочная величина
            и не сопровождается квалификационной категорией.
          </Notice>
        )}
        <Notice tone="method">{report.disclaimers.purpose}</Notice>
        <Notice tone="method">{report.disclaimers.confidence}</Notice>

        <div className="mt-3">
          <DefinitionList
            items={[
              { term: 'Стаж, лет', value: report.candidate.experienceYears ?? '—' },
              { term: 'Прохождение', value: `${formatDateTime(report.session.startedAt)} — ${formatDateTime(report.session.completedAt)}` },
              { term: 'Длительность', value: formatDuration(report.session.durationMinutes) },
              { term: 'Статус оценки', value: report.session.assessmentStatus },
              { term: 'Модель скоринга', value: report.versions.scoringModel ?? '—' },
              { term: 'Версия движка решётки', value: report.versions.gridEngineVersion ?? '—' },
              { term: 'Модели оценки', value: report.versions.llmModels.join(', ') || '—' },
              { term: 'Шаблоны промптов', value: report.versions.promptTemplates.join(', ') || '—' },
            ]}
          />
        </div>
      </Card>

      {/* Карта компетенций: график и обязательный табличный эквивалент (§52). */}
      <ChartWithTable
        title="Профиль по направлениям"
        note="Шкала 0–4. Значение «нет данных» не равно нулю."
        chart={<RadarChart data={axisData} max={4} />}
        table={
          <Table
            headers={[
              { label: 'Направление' },
              { label: 'Балл 0–100', align: 'right' },
              { label: 'Уровень' },
              { label: 'Уверенность', align: 'right' },
            ]}
          >
            {report.axes.map((axis) => (
              <tr key={axis.axis}>
                <Td>{AXIS_LABELS[axis.axis] ?? axis.axis}</Td>
                <Td numeric align="right">
                  {axis.score0to100 === null ? 'нет данных' : formatNumber(axis.score0to100, 1)}
                </Td>
                <Td>{axis.level === null ? '—' : `${axis.level} — ${LEVEL_LABELS[axis.level]}`}</Td>
                <Td numeric align="right">
                  {formatNumber(axis.confidence)}
                </Td>
              </tr>
            ))}
          </Table>
        }
      />

      <Card title="Компетенции" subtitle="Любой балл кликабелен: раскрывается до вопросов, ответов и цитат">
        <Table
          headers={[
            { label: 'Компетенция' },
            { label: 'Вес', align: 'right' },
            { label: 'Уровень 0–4' },
            { label: 'Категория' },
            { label: 'Уверенность', align: 'right' },
            { label: 'Доказательств', align: 'right' },
            { label: 'Вопросов', align: 'right' },
            { label: '' },
          ]}
        >
          {report.competencies.map((competency) => (
            <tr key={competency.competencyCode} className="hover:bg-graphite-50">
              <Td>
                {competency.competencyTitle}
                {competency.isHardGate && (
                  <span className="ml-1.5">
                    <Tag>критическая</Tag>
                  </span>
                )}
                {competency.humanReviewed && (
                  <span className="ml-1.5">
                    <Tag tone="accent">проверено экспертом</Tag>
                  </span>
                )}
              </Td>
              <Td numeric align="right">
                {formatNumber(competency.weight, 1)}%
              </Td>
              <Td>
                <LevelIndicator
                  score={competency.score0to4}
                  level={competency.level}
                  notEnoughEvidence={competency.notEnoughEvidence}
                />
              </Td>
              <Td>{competency.levelTitle ?? '—'}</Td>
              <Td numeric align="right">
                {formatNumber(competency.confidence)}
              </Td>
              <Td numeric align="right">
                {competency.evidenceCount}
              </Td>
              <Td numeric align="right">
                {competency.questionCount}
              </Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => void openDrill(competency.competencyCode)}>
                  Раскрыть
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
        <Notice tone="method">{report.disclaimers.notEnoughEvidence}</Notice>
      </Card>

      {drillBusy && <Spinner label="Загрузка детализации" />}
      {drill && (
        <DrillDownPanel
          drill={drill}
          canReview={canReview}
          onClose={() => setDrill(null)}
          onReviewed={async () => {
            await load();
            await openDrill(drill.competencyCode);
          }}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Сильные стороны" subtitle="Только подтверждённые цитатами">
          {report.strengths.length === 0 ? (
            <EmptyState title="Подтверждённых сильных сторон не зафиксировано" />
          ) : (
            <ul className="space-y-2.5 text-sm">
              {report.strengths.map((item, index) => (
                <li key={`${item.answerId}-${index}`} className="border-l-2 border-l-accent-400 pl-3">
                  <div className="text-2xs text-graphite-500">{item.competencyCode}</div>
                  <div className="italic text-graphite-800">«{item.quote}»</div>
                  {item.comment && <div className="mt-0.5 text-xs text-graphite-600">{item.comment}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Компетенции, требующие дополнительной проверки">
          {report.toVerify.length === 0 ? (
            <EmptyState title="Не выявлено" />
          ) : (
            <Table
              headers={[{ label: 'Компетенция' }, { label: 'Основание' }, { label: 'Уровень', align: 'right' }]}
            >
              {report.toVerify.map((item) => (
                <tr key={item.competencyCode}>
                  <Td>{item.competencyTitle}</Td>
                  <Td>{item.reason}</Td>
                  <Td numeric align="right">
                    {item.score === null ? 'нет данных' : formatNumber(item.score)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {report.criticalGaps.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-600">
                Критические компетенции
              </h3>
              <ul className="space-y-1.5 text-sm">
                {report.criticalGaps.map((gap) => (
                  <li key={gap.competencyCode} className="border-l-2 border-l-warnTech-500 pl-3">
                    <span className="font-medium">{gap.competencyCode}</span>: {gap.message}
                    {gap.score0to4 !== null && (
                      <span className="tnum ml-1 text-xs text-graphite-600">
                        (уровень {formatNumber(gap.score0to4)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <Notice tone="method">{report.disclaimers.hardGate}</Notice>
            </>
          )}
        </Card>
      </div>

      <Card title="Профессиональные маркеры риска" subtitle="Каждый маркер ссылается на конкретный ответ">
        {report.riskFlags.filter((flag) => !flag.dismissed).length === 0 ? (
          <EmptyState title="Маркеры риска не зафиксированы" />
        ) : (
          <Table
            headers={[
              { label: 'Маркер' },
              { label: 'Значимость' },
              { label: 'Источник' },
              { label: 'Цитата / основание' },
              { label: 'Пояснение' },
              { label: '' },
            ]}
          >
            {report.riskFlags
              .filter((flag) => !flag.dismissed)
              .map((flag) => (
                <tr key={flag.id}>
                  <Td>{flag.title}</Td>
                  <Td>{flag.severity}</Td>
                  <Td>{flag.source}</Td>
                  <Td className="italic">{flag.quote ? `«${flag.quote}»` : '—'}</Td>
                  <Td>{flag.explanation}</Td>
                  <Td>
                    {canReview && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await api.post(`/api/risk-flags/${flag.id}`, { action: 'CONFIRM' });
                            await load();
                          }}
                        >
                          Подтвердить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await api.post(`/api/risk-flags/${flag.id}`, { action: 'DISMISS' });
                            await load();
                          }}
                        >
                          Снять
                        </Button>
                      </div>
                    )}
                    {flag.confirmed && <Tag tone="accent">подтверждён</Tag>}
                  </Td>
                </tr>
              ))}
          </Table>
        )}
      </Card>

      <Card title="Персональные профессиональные конструкты">
        {report.constructs.length === 0 ? (
          <EmptyState title="Конструкты не сформированы" />
        ) : (
          <div className="space-y-3">
            {report.constructs.map((construct) => (
              <div key={construct.id} className="rounded border border-graphite-200 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{construct.poleLeft}</span>
                  <span className="text-graphite-400">↔</span>
                  <span className="font-medium">{construct.poleRight}</span>
                  {construct.importanceRank && <Tag>ранг значимости {construct.importanceRank}</Tag>}
                  {construct.isDuplicate && <Tag>отмечен кандидатом как совпадающий</Tag>}
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  {construct.importanceReason && (
                    <div>
                      <dt className="inline font-semibold text-graphite-600">Почему важно: </dt>
                      <dd className="inline text-graphite-800">{construct.importanceReason}</dd>
                    </div>
                  )}
                  {construct.rigManifestation && (
                    <div>
                      <dt className="inline font-semibold text-graphite-600">На буровой: </dt>
                      <dd className="inline text-graphite-800">{construct.rigManifestation}</dd>
                    </div>
                  )}
                  {construct.experienceExample && (
                    <div>
                      <dt className="inline font-semibold text-graphite-600">Пример из опыта: </dt>
                      <dd className="inline text-graphite-800">{construct.experienceExample}</dd>
                    </div>
                  )}
                </dl>
                {construct.ladder.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-graphite-700">
                    {construct.ladder.map((step) => (
                      <li key={step.depth}>
                        {step.answer}
                        {step.terminalTag && <span className="ml-1.5"><Tag>{step.terminalTag}</Tag></span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <ChartWithTable
        title="Репертуарная решётка"
        note={report.grid.metrics?.disclaimer}
        chart={<GridHeatmap elements={report.grid.elements} rows={report.grid.rows} />}
        table={
          <Table
            headers={[
              { label: 'Критерий (левый полюс)' },
              ...report.grid.elements.map((element) => ({ label: element.code, align: 'right' as const })),
            ]}
          >
            {report.grid.rows.map((row) => (
              <tr key={row.constructId}>
                <Td>{row.poleLeft}</Td>
                {row.values.map((value, index) => (
                  <Td key={index} numeric align="right">
                    {value ?? '—'}
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
        }
      />

      {report.grid.metrics && (
        <Card title="Расхождение «Я сейчас» / «Идеальный инженер»">
          <Table
            headers={[
              { label: 'Сравнение' },
              { label: 'Манхэттен', align: 'right' },
              { label: 'Нормировано 0–1', align: 'right' },
              { label: 'Евклид', align: 'right' },
              { label: 'Конструктов', align: 'right' },
            ]}
          >
            {[
              ['«Я сейчас» ↔ «Идеальный инженер»', report.grid.metrics.distances.selfToIdeal],
              ['«Я сейчас» ↔ «Один из лучших»', report.grid.metrics.distances.selfToBest],
              ['«Я сейчас» ↔ «Не оставил бы самостоятельно»', report.grid.metrics.distances.selfToWeak],
            ].map(([label, distance]) => {
              const value = distance as { manhattan: number; manhattanNormalized: number; euclidean: number; comparedConstructs: number } | null;
              return (
                <tr key={label as string}>
                  <Td>{label as string}</Td>
                  <Td numeric align="right">{value ? formatNumber(value.manhattan, 0) : '—'}</Td>
                  <Td numeric align="right">{value ? formatNumber(value.manhattanNormalized) : '—'}</Td>
                  <Td numeric align="right">{value ? formatNumber(value.euclidean) : '—'}</Td>
                  <Td numeric align="right">{value ? value.comparedConstructs : '—'}</Td>
                </tr>
              );
            })}
          </Table>
          <Table headers={[{ label: 'Показатель' }, { label: 'Значение', align: 'right' }]}>
            <tr>
              <Td>Поляризация оценок</Td>
              <Td numeric align="right">{formatPercent(report.grid.metrics.polarization)}</Td>
            </tr>
            <tr>
              <Td>Доля промежуточных оценок</Td>
              <Td numeric align="right">{formatPercent(report.grid.metrics.midpointShare)}</Td>
            </tr>
            <tr>
              <Td>Кластеров конструктов</Td>
              <Td numeric align="right">{report.grid.metrics.clusters.length}</Td>
            </tr>
            <tr>
              <Td>Потенциально близких пар конструктов</Td>
              <Td numeric align="right">{report.grid.metrics.potentialDuplicatePairs.length}</Td>
            </tr>
            <tr>
              <Td>Внутренняя несогласованность</Td>
              <Td numeric align="right">{formatPercent(report.grid.metrics.inconsistencyShare)}</Td>
            </tr>
            <tr>
              <Td>Сигнал профессиональной рефлексии</Td>
              <Td numeric align="right">{formatNumber(report.grid.metrics.reflectionSignal)}</Td>
            </tr>
          </Table>
          <Notice tone="method">{report.grid.metrics.disclaimer}</Notice>
        </Card>
      )}

      <Card title="Анализ ситуационных кейсов">
        {report.cases.length === 0 ? (
          <EmptyState title="Кейсы не пройдены" />
        ) : (
          <div className="space-y-4">
            {report.cases.map((item) => (
              <details key={item.scenarioCode} className="rounded border border-graphite-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-graphite-900">
                  {item.scenarioTitle}
                  <span className="ml-2 font-mono text-2xs text-graphite-400">{item.scenarioCode}</span>
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  {item.stages.map((stage) => (
                    <div key={stage.stageIndex}>
                      <div className="text-xs font-semibold text-graphite-600">Этап {stage.stageIndex + 1}</div>
                      <p className="mt-1 bg-graphite-50 px-2.5 py-2 text-xs text-graphite-700">{stage.situation}</p>
                      {stage.answers.map((answer) => (
                        <CaseAnswer key={answer.answerId} value={answer.value} />
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Расхождения между декларациями и решениями">
          {report.contradictions.length === 0 ? (
            <EmptyState title="Расхождений не выявлено" />
          ) : (
            <>
              <ul className="space-y-2 text-sm">
                {report.contradictions.map((item, index) => (
                  <li key={index} className="border-l-2 border-l-accent-400 pl-3">
                    {item.description}
                    <span className="tnum ml-1 text-xs text-graphite-500">(сила {formatNumber(item.strength)})</span>
                  </li>
                ))}
              </ul>
              <Notice tone="method">{report.disclaimers.contradiction}</Notice>
            </>
          )}
        </Card>

        <Card title="Рекомендованные вопросы для очного собеседования">
          {report.interviewQuestions.length === 0 ? (
            <EmptyState title="Вопросы не сформированы" />
          ) : (
            <ol className="list-decimal space-y-2.5 pl-5 text-sm">
              {report.interviewQuestions.map((question, index) => (
                <li key={index}>
                  <div className="text-graphite-900">{question.text}</div>
                  <div className="mt-0.5 text-2xs text-graphite-500">
                    Основание: {question.rationale}
                    {question.competencyCode ? ` · ${question.competencyCode}` : ''} · ответов-источников:{' '}
                    {question.refAnswerIds.length}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Заключение технического эксперта">
        {report.expertConclusion.length === 0 ? (
          <EmptyState title="Экспертная проверка не выполнялась" />
        ) : (
          <Table
            headers={[
              { label: 'Компетенция' },
              { label: 'Модель', align: 'right' },
              { label: 'Эксперт', align: 'right' },
              { label: 'Итог', align: 'right' },
              { label: 'Причина изменения' },
              { label: 'Эксперт' },
              { label: 'Дата' },
            ]}
          >
            {report.expertConclusion.map((item, index) => (
              <tr key={index}>
                <Td>{item.competencyCode}</Td>
                <Td numeric align="right">{formatNumber(item.modelScore)}</Td>
                <Td numeric align="right">{formatNumber(item.humanScore)}</Td>
                <Td numeric align="right">{formatNumber(item.finalScore)}</Td>
                <Td>{item.reviewReason}</Td>
                <Td>{item.reviewerName}</Td>
                <Td numeric>{formatDateTime(item.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {canReview && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await api.post(`/api/sessions/${report.session.id}/review-complete`);
                await load();
              }}
            >
              Завершить экспертную проверку
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await api.post(`/api/sessions/${report.session.id}/recompute`);
                await load();
              }}
            >
              Пересчитать итоги
            </Button>
          </div>
        )}
      </Card>

      <Notice tone="method">{report.disclaimers.protectedAttributes}</Notice>
    </div>
  );
}

const CASE_FIELD_LABELS: Record<string, string> = {
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

function CaseAnswer({ value }: { value: unknown }) {
  const parsed = value as { kind?: string; fields?: Record<string, string>; text?: string } | null;
  if (parsed?.kind === 'CASE' && parsed.fields) {
    return (
      <dl className="mt-2 space-y-1 text-xs">
        {Object.entries(parsed.fields).map(([key, text]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite-500">{CASE_FIELD_LABELS[key] ?? key}</dt>
            <dd className="text-graphite-800">{text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="mt-2 whitespace-pre-line text-xs text-graphite-800">{parsed?.text ?? '—'}</p>;
}

function DrillDownPanel({
  drill,
  canReview,
  onClose,
  onReviewed,
}: {
  drill: DrillDown;
  canReview: boolean;
  onClose: () => void;
  onReviewed: () => Promise<void>;
}) {
  return (
    <Card
      title={`Детализация: ${drill.competencyTitle}`}
      subtitle={
        drill.finalScore
          ? `Итоговый уровень ${drill.finalScore.notEnoughEvidence ? 'недостаточно данных' : formatNumber(drill.finalScore.score0to4)}, уверенность ${formatNumber(drill.finalScore.confidence)}`
          : 'Итоговый балл не рассчитан'
      }
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Свернуть
        </Button>
      }
    >
      <details className="mb-4 rounded border border-graphite-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-graphite-700">
          Применённая rubric
        </summary>
        <Table headers={[{ label: 'Уровень', align: 'right' }, { label: 'Описание' }]}>
          {drill.rubric.map((level) => (
            <tr key={level.level}>
              <Td numeric align="right">{level.level}</Td>
              <Td>{level.descriptor}</Td>
            </tr>
          ))}
        </Table>
      </details>

      {drill.items.length === 0 ? (
        <EmptyState title="Нет вопросов, измеряющих эту компетенцию" />
      ) : (
        <div className="space-y-4">
          {drill.items.map((item) => (
            <div key={item.answerId} className="rounded border border-graphite-200 px-3 py-2.5">
              <div className="mb-1 text-xs text-graphite-500">
                <span className="font-mono">{item.questionCode}</span>
                {item.scenario && ` · ${item.scenario.title}, этап ${item.scenario.stageIndex + 1}`}
              </div>
              <p className="mb-2 text-sm text-graphite-800">{item.questionPrompt}</p>

              <details className="mb-2">
                <summary className="cursor-pointer text-xs font-semibold text-graphite-700">
                  Ответ кандидата
                </summary>
                <CaseAnswer value={item.answerValue} />
              </details>

              <Table
                headers={[
                  { label: 'Оценщик' },
                  { label: 'Балл', align: 'right' },
                  { label: 'Уверенность', align: 'right' },
                  { label: 'Правило rubric' },
                  { label: 'Обоснование' },
                  { label: 'Цитаты' },
                ]}
              >
                {item.evaluators.map((evaluator, index) => (
                  <tr key={`${evaluator.role}-${index}`}>
                    <Td>
                      {evaluator.role}
                      <div className="text-2xs text-graphite-400">
                        {evaluator.provider}:{evaluator.model}
                      </div>
                    </Td>
                    <Td numeric align="right">
                      {evaluator.notEnoughEvidence ? 'нет данных' : formatNumber(evaluator.score)}
                    </Td>
                    <Td numeric align="right">{formatNumber(evaluator.confidence)}</Td>
                    <Td className="text-xs">{evaluator.rubricRule || '—'}</Td>
                    <Td className="text-xs">{evaluator.explanation}</Td>
                    <Td className="text-xs">
                      {evaluator.quotes.length === 0 ? (
                        '—'
                      ) : (
                        <ul className="space-y-1">
                          {evaluator.quotes.map((quote, quoteIndex) => (
                            <li key={quoteIndex} className="italic">
                              «{quote.quote}»
                              {!quote.verified && (
                                <span className="ml-1 not-italic">
                                  <Tag tone="tech">цитата не подтверждена</Tag>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>

              {item.humanReviews.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-graphite-700">История корректировок</div>
                  <Table
                    headers={[
                      { label: 'Модель', align: 'right' },
                      { label: 'Эксперт', align: 'right' },
                      { label: 'Итог', align: 'right' },
                      { label: 'Причина' },
                      { label: 'Автор' },
                      { label: 'Дата' },
                    ]}
                  >
                    {item.humanReviews.map((review, index) => (
                      <tr key={index}>
                        <Td numeric align="right">{formatNumber(review.modelScore)}</Td>
                        <Td numeric align="right">
                          {review.markedUninformative ? 'недостаточно данных' : formatNumber(review.humanScore)}
                        </Td>
                        <Td numeric align="right">{formatNumber(review.finalScore)}</Td>
                        <Td>{review.reviewReason}</Td>
                        <Td>{review.reviewerName}</Td>
                        <Td numeric>{formatDateTime(review.createdAt)}</Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}

              {canReview && (
                <ReviewPanel
                  answerId={item.answerId}
                  competencyCode={drill.competencyCode}
                  modelScore={item.evaluators[0]?.score ?? null}
                  onSubmitted={onReviewed}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
