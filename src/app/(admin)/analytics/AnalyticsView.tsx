'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, queryString } from '../../../lib/api.js';
import {
  Button,
  Card,
  ChartWithTable,
  EmptyState,
  FilterField,
  Notice,
  Select,
  Spinner,
  Table,
  Tag,
  Td,
} from '../../../components/ui/index.js';
import { BarChart, DistributionChart } from '../../../components/charts/index.js';
import { BAND_LABELS, formatDuration, formatNumber, formatPercent } from '../../../lib/format.js';

/** Аналитика (§49) и качество вопросов (§50). */

interface Summary {
  invitations: { total: number; byStatus: Record<string, number> };
  sessions: {
    total: number;
    completed: number;
    inProgress: number;
    expired: number;
    completionRate: number;
    averageDurationMinutes: number | null;
    pendingAssessment: number;
    reviewRequired: number;
  };
  scores: {
    averageOverall: number | null;
    medianOverall: number | null;
    distribution: Array<{ band: string; count: number }>;
    histogram: Array<{ bucket: string; count: number }>;
    insufficientData: number;
  };
  competencies: Array<{
    code: string;
    title: string;
    averageScore0to4: number | null;
    averageConfidence: number;
    notEnoughEvidenceShare: number;
    sampleSize: number;
  }>;
  riskFlags: Array<{ code: string; title: string; count: number; share: number }>;
  disagreement: {
    comparedPairs: number;
    averageAbsoluteDelta: number | null;
    exceedingThresholdShare: number;
    humanOverrideRate: number;
  };
  byPosition: Array<{ code: string; title: string; sessions: number; averageOverall: number | null }>;
  queue: Record<string, number>;
  notes: string[];
}

interface QuestionStat {
  questionVersionId: string;
  questionCode: string;
  section: string;
  prompt: string;
  completionRate: number | null;
  averageScore: number | null;
  variance: number | null;
  correlationWithTotal: number | null;
  humanOverrideRate: number | null;
  missingDataFrequency: number | null;
  sampleSize: number;
  needsMethodicalReview: boolean;
  reviewReasons: string[];
}

export function AnalyticsView() {
  const [positionCode, setPositionCode] = useState('');
  const [positions, setPositions] = useState<Array<{ code: string; title: string }>>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [questions, setQuestions] = useState<QuestionStat[] | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ items: Array<{ code: string; title: string }> }>('/api/positions');
      setPositions(result.items);
    })();
  }, []);

  const load = useCallback(async () => {
    setSummary(null);
    setQuestions(null);
    const [summaryResult, questionResult] = await Promise.all([
      api.get<Summary>(`/api/analytics${queryString({ positionCode })}`),
      api.get<{ items: QuestionStat[] }>(`/api/analytics/questions${queryString({ positionCode })}`),
    ]);
    setSummary(summaryResult);
    setQuestions(questionResult.items);
  }, [positionCode]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary || !questions) return <Spinner label="Загрузка аналитики" />;

  return (
    <div className="space-y-5">
      <Card
        title="Параметры выборки"
        actions={
          <a
            href={`/api/analytics/export${queryString({ positionCode, format: 'xlsx' })}`}
            className="rounded border border-graphite-300 px-2.5 py-1 text-xs text-graphite-700 hover:bg-graphite-100"
          >
            Экспорт XLSX
          </a>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Должность" className="w-64">
            {({ id }) => (
              <Select id={id} value={positionCode} onChange={(event) => setPositionCode(event.target.value)}>
                <option value="">все должности</option>
                {positions.map((position) => (
                  <option key={position.code} value={position.code}>
                    {position.title}
                  </option>
                ))}
              </Select>
            )}
          </FilterField>
          <Button size="sm" onClick={() => void load()}>
            Обновить
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { label: 'Приглашений', value: summary.invitations.total },
          { label: 'Сессий', value: summary.sessions.total },
          { label: 'Завершено', value: summary.sessions.completed },
          { label: 'Доля завершения', value: formatPercent(summary.sessions.completionRate) },
          { label: 'Средняя длительность', value: formatDuration(summary.sessions.averageDurationMinutes) },
          { label: 'Средний итог', value: formatNumber(summary.scores.averageOverall, 1) },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-graphite-200 bg-white px-3 py-3">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">{tile.label}</div>
            <div className="tnum mt-1 text-xl font-semibold text-graphite-900">{tile.value}</div>
          </div>
        ))}
      </div>

      {summary.notes.map((note) => (
        <Notice key={note} tone="method">
          {note}
        </Notice>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartWithTable
          title="Распределение итоговых баллов"
          chart={<DistributionChart buckets={summary.scores.histogram} />}
          table={
            <Table headers={[{ label: 'Диапазон' }, { label: 'Кандидатов', align: 'right' }]}>
              {summary.scores.histogram.map((bucket) => (
                <tr key={bucket.bucket}>
                  <Td>{bucket.bucket}</Td>
                  <Td numeric align="right">
                    {bucket.count}
                  </Td>
                </tr>
              ))}
            </Table>
          }
        />

        <Card title="Квалификационные категории">
          <Table headers={[{ label: 'Категория' }, { label: 'Кандидатов', align: 'right' }]}>
            {summary.scores.distribution.map((item) => (
              <tr key={item.band}>
                <Td>{BAND_LABELS[item.band] ?? item.band}</Td>
                <Td numeric align="right">
                  {item.count}
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-2xs text-graphite-500">
            Сессий с недостаточным покрытием данными: {summary.scores.insufficientData}
          </p>
        </Card>
      </div>

      <ChartWithTable
        title="Слабые компетенции выборки"
        note="Низкий средний уровень может отражать как подготовку кандидатов, так и качество вопросов — сверяйтесь со статистикой качества вопросов."
        chart={
          <BarChart
            data={summary.competencies.slice(0, 12).map((competency) => ({
              label: competency.code,
              value: competency.averageScore0to4,
            }))}
            max={4}
          />
        }
        table={
          <Table
            headers={[
              { label: 'Компетенция' },
              { label: 'Средний уровень 0–4', align: 'right' },
              { label: 'Средняя уверенность', align: 'right' },
              { label: 'Доля без данных', align: 'right' },
              { label: 'Выборка', align: 'right' },
            ]}
          >
            {summary.competencies.map((competency) => (
              <tr key={competency.code}>
                <Td>{competency.title}</Td>
                <Td numeric align="right">
                  {formatNumber(competency.averageScore0to4)}
                </Td>
                <Td numeric align="right">
                  {formatNumber(competency.averageConfidence)}
                </Td>
                <Td numeric align="right">
                  {formatPercent(competency.notEnoughEvidenceShare)}
                </Td>
                <Td numeric align="right">
                  {competency.sampleSize}
                </Td>
              </tr>
            ))}
          </Table>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Частота маркеров риска">
          {summary.riskFlags.length === 0 ? (
            <EmptyState title="Маркеры риска не зафиксированы" />
          ) : (
            <Table
              headers={[{ label: 'Маркер' }, { label: 'Случаев', align: 'right' }, { label: 'Доля сессий', align: 'right' }]}
            >
              {summary.riskFlags.map((flag) => (
                <tr key={flag.code}>
                  <Td>{flag.title}</Td>
                  <Td numeric align="right">
                    {flag.count}
                  </Td>
                  <Td numeric align="right">
                    {formatPercent(flag.share)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Согласованность оценки">
          <Table headers={[{ label: 'Показатель' }, { label: 'Значение', align: 'right' }]}>
            <tr>
              <Td>Сопоставленных пар оценщиков</Td>
              <Td numeric align="right">{summary.disagreement.comparedPairs}</Td>
            </tr>
            <tr>
              <Td>Среднее расхождение оценщиков</Td>
              <Td numeric align="right">{formatNumber(summary.disagreement.averageAbsoluteDelta)}</Td>
            </tr>
            <tr>
              <Td>Доля расхождений ≥ 1 балла</Td>
              <Td numeric align="right">{formatPercent(summary.disagreement.exceedingThresholdShare)}</Td>
            </tr>
            <tr>
              <Td>Частота экспертных корректировок</Td>
              <Td numeric align="right">{formatPercent(summary.disagreement.humanOverrideRate)}</Td>
            </tr>
            {Object.entries(summary.queue).map(([key, value]) => (
              <tr key={key}>
                <Td>Очередь: {key}</Td>
                <Td numeric align="right">{value}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card
        title="Качество вопросов"
        subtitle="Вопросы не удаляются автоматически: отметка означает необходимость методической проверки"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await api.post('/api/analytics/questions');
              await load();
            }}
          >
            Пересчитать статистику
          </Button>
        }
      >
        {questions.length === 0 ? (
          <EmptyState title="Статистика ещё не рассчитана" description="Нажмите «Пересчитать статистику»." />
        ) : (
          <Table
            headers={[
              { label: 'Код' },
              { label: 'Раздел' },
              { label: 'Завершаемость', align: 'right' },
              { label: 'Средний балл', align: 'right' },
              { label: 'Дисперсия', align: 'right' },
              { label: 'Связь с итогом', align: 'right' },
              { label: 'Корректировки', align: 'right' },
              { label: 'Без данных', align: 'right' },
              { label: 'Выборка', align: 'right' },
              { label: 'Отметка' },
            ]}
          >
            {questions.map((question) => (
              <tr key={question.questionVersionId}>
                <Td className="font-mono text-2xs">{question.questionCode}</Td>
                <Td className="text-xs">{question.section}</Td>
                <Td numeric align="right">{formatPercent(question.completionRate)}</Td>
                <Td numeric align="right">{formatNumber(question.averageScore)}</Td>
                <Td numeric align="right">{formatNumber(question.variance, 3)}</Td>
                <Td numeric align="right">{formatNumber(question.correlationWithTotal, 3)}</Td>
                <Td numeric align="right">{formatPercent(question.humanOverrideRate)}</Td>
                <Td numeric align="right">{formatPercent(question.missingDataFrequency)}</Td>
                <Td numeric align="right">{question.sampleSize}</Td>
                <Td className="text-2xs">
                  {question.needsMethodicalReview ? (
                    <>
                      <Tag tone="tech">требует проверки</Tag>
                      <div className="mt-0.5 text-graphite-500">{question.reviewReasons.join('; ')}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
