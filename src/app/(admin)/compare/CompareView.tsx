'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiRequestError, api } from '../../../lib/api.js';
import {
  Card,
  ChartWithTable,
  EmptyState,
  LevelIndicator,
  Notice,
  Spinner,
  Table,
  Td,
  TechError,
} from '../../../components/ui/index.js';
import { RadarChart } from '../../../components/charts/index.js';
import { AXIS_LABELS, BAND_LABELS, formatNumber, formatPercent } from '../../../lib/format.js';

/**
 * Сравнение до пяти кандидатов (§47).
 * Автоматический рейтинг по итоговому баллу не формируется.
 */

interface ComparisonEntry {
  candidateId: string;
  sessionId: string;
  fullName: string;
  positionTitle: string;
  overall: number | null;
  band: string | null;
  bandTitle: string | null;
  confidence: number;
  coverage: number | null;
  competencies: Array<{
    code: string;
    title: string;
    score0to4: number | null;
    level: number | null;
    confidence: number;
    notEnoughEvidence: boolean;
  }>;
  axes: Array<{ axis: string; score0to100: number | null; confidence: number }>;
  riskFlags: Array<{ code: string; severity: string; explanation: string }>;
  constructs: Array<{ poleLeft: string; poleRight: string; importanceRank: number | null }>;
  expertReviews: number;
}

interface Comparison {
  entries: ComparisonEntry[];
  competencyColumns: Array<{ code: string; title: string }>;
  notes: string[];
}

export function CompareView() {
  const params = useSearchParams();
  const sessions = (params.get('sessions') ?? '').split(',').filter(Boolean);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (sessions.length < 2) return;
    try {
      setData(await api.post<Comparison>('/api/candidates/compare', { sessionIds: sessions }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось выполнить сравнение');
    }
  }, [sessions.join(',')]);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessions.length < 2) {
    return (
      <EmptyState
        title="Выберите кандидатов для сравнения"
        description="Отметьте от двух до пяти кандидатов в разделе «Кандидаты» и нажмите «Сравнить выбранных»."
      />
    );
  }

  if (error) return <TechError>{error}</TechError>;
  if (!data) return <Spinner label="Загрузка сравнения" />;

  const axisCodes = [...new Set(data.entries.flatMap((entry) => entry.axes.map((axis) => axis.axis)))];

  return (
    <div className="space-y-5">
      <Card title="Сравнение кандидатов">
        {data.notes.map((note) => (
          <Notice key={note} tone="method">
            {note}
          </Notice>
        ))}
        <Table
          headers={[
            { label: 'Показатель' },
            ...data.entries.map((entry) => ({ label: entry.fullName })),
          ]}
        >
          <tr>
            <Td>Должность</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId}>{entry.positionTitle}</Td>
            ))}
          </tr>
          <tr>
            <Td>Итоговый балл</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} numeric>
                {entry.overall === null ? '—' : formatNumber(entry.overall, 1)}
              </Td>
            ))}
          </tr>
          <tr>
            <Td>Квалификационный уровень</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} className="text-xs">
                {entry.band ? BAND_LABELS[entry.band] : '—'}
              </Td>
            ))}
          </tr>
          <tr>
            <Td>Уверенность</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} numeric>
                {formatNumber(entry.confidence)}
              </Td>
            ))}
          </tr>
          <tr>
            <Td>Покрытие данными</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} numeric>
                {formatPercent(entry.coverage)}
              </Td>
            ))}
          </tr>
          <tr>
            <Td>Маркеров риска</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} numeric>
                {entry.riskFlags.length}
              </Td>
            ))}
          </tr>
          <tr>
            <Td>Экспертных корректировок</Td>
            {data.entries.map((entry) => (
              <Td key={entry.sessionId} numeric>
                {entry.expertReviews}
              </Td>
            ))}
          </tr>
        </Table>
      </Card>

      <Card title="Компетенции">
        <Table
          headers={[
            { label: 'Компетенция' },
            ...data.entries.map((entry) => ({ label: entry.fullName })),
          ]}
        >
          {data.competencyColumns.map((column) => (
            <tr key={column.code}>
              <Td>{column.title}</Td>
              {data.entries.map((entry) => {
                const competency = entry.competencies.find((item) => item.code === column.code);
                return (
                  <Td key={entry.sessionId}>
                    {competency ? (
                      <LevelIndicator
                        score={competency.score0to4}
                        level={competency.level}
                        notEnoughEvidence={competency.notEnoughEvidence}
                      />
                    ) : (
                      '—'
                    )}
                  </Td>
                );
              })}
            </tr>
          ))}
        </Table>
      </Card>

      {data.entries.map((entry) => (
        <ChartWithTable
          key={entry.sessionId}
          title={`Профиль направлений: ${entry.fullName}`}
          chart={
            <RadarChart
              data={entry.axes.map((axis) => ({
                label: AXIS_LABELS[axis.axis] ?? axis.axis,
                value: axis.score0to100 === null ? null : (axis.score0to100 / 100) * 4,
              }))}
              max={4}
            />
          }
          table={
            <Table headers={[{ label: 'Направление' }, { label: 'Балл 0–100', align: 'right' }, { label: 'Уверенность', align: 'right' }]}>
              {axisCodes.map((code) => {
                const axis = entry.axes.find((item) => item.axis === code);
                return (
                  <tr key={code}>
                    <Td>{AXIS_LABELS[code] ?? code}</Td>
                    <Td numeric align="right">
                      {axis?.score0to100 === null || axis === undefined ? '—' : formatNumber(axis.score0to100, 1)}
                    </Td>
                    <Td numeric align="right">
                      {axis ? formatNumber(axis.confidence) : '—'}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          }
        />
      ))}

      <Card title="Персональные конструкты">
        <div className="grid gap-4 lg:grid-cols-2">
          {data.entries.map((entry) => (
            <div key={entry.sessionId}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-graphite-600">
                {entry.fullName}
              </h3>
              <ul className="space-y-1 text-xs">
                {entry.constructs.map((construct, index) => (
                  <li key={index}>
                    <span className="font-medium">{construct.poleLeft}</span>
                    <span className="mx-1.5 text-graphite-400">↔</span>
                    <span className="font-medium">{construct.poleRight}</span>
                    {construct.importanceRank && (
                      <span className="ml-1 text-graphite-400">(ранг {construct.importanceRank})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
