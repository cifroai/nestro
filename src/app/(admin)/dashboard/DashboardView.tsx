'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';
import { Card, EmptyState, Notice, Spinner, Table, Tag, Td } from '../../../components/ui/index.js';
import { BAND_LABELS, formatDateTime, formatNumber, formatPercent } from '../../../lib/format.js';

/** Дашборд HR (§26): счётчики воронки и последние кандидаты. */

interface Counters {
  invited: number;
  started: number;
  completed: number;
  reviewRequired: number;
  scored: number;
  pendingAssessment: number;
}

interface CandidateRow {
  candidateId: string;
  sessionId: string | null;
  fullName: string;
  positionTitle: string;
  status: string;
  assessmentStatus: string;
  completedAt: string | null;
  overall: number | null;
  band: string | null;
  confidence: number | null;
  coverage: number | null;
  riskFlagCount: number;
  reviewRequired: boolean;
}

export function DashboardView() {
  const [counters, setCounters] = useState<Counters | null>(null);
  const [rows, setRows] = useState<CandidateRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const [countersResult, list] = await Promise.all([
        api.get<Counters>('/api/candidates/dashboard'),
        api.get<{ items: CandidateRow[] }>('/api/candidates?pageSize=15&sort=completedAt&order=desc'),
      ]);
      setCounters(countersResult);
      setRows(list.items);
    })();
  }, []);

  if (!counters || !rows) return <Spinner label="Загрузка дашборда" />;

  const tiles: Array<{ label: string; value: number; hint?: string }> = [
    { label: 'Приглашено', value: counters.invited },
    { label: 'Начали тестирование', value: counters.started },
    { label: 'Завершили', value: counters.completed },
    { label: 'Ожидает автоматической оценки', value: counters.pendingAssessment, hint: 'Обрабатывается в очереди' },
    { label: 'Требует экспертной проверки', value: counters.reviewRequired },
    { label: 'Оценено', value: counters.scored },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded border border-graphite-200 bg-white px-3 py-3">
            <div className="text-2xs uppercase tracking-wide text-graphite-500">{tile.label}</div>
            <div className="tnum mt-1 text-2xl font-semibold text-graphite-900">{tile.value}</div>
            {tile.hint && <div className="mt-0.5 text-2xs text-graphite-400">{tile.hint}</div>}
          </div>
        ))}
      </div>

      <Notice tone="method">
        Итоговая оценка является поддержкой решения: она содержит доказательства, зоны риска и
        уровень уверенности. Кадровое решение принимает человек.
      </Notice>

      <Card title="Последние кандидаты">
        {rows.length === 0 ? (
          <EmptyState
            title="Кандидатов пока нет"
            description="Создайте приглашение в разделе «Приглашения»."
          />
        ) : (
          <Table
            headers={[
              { label: 'ФИО' },
              { label: 'Должность' },
              { label: 'Статус' },
              { label: 'Завершено' },
              { label: 'Итог', align: 'right' },
              { label: 'Уровень' },
              { label: 'Уверенность', align: 'right' },
              { label: 'Покрытие', align: 'right' },
              { label: 'Маркеры', align: 'right' },
              { label: 'Проверка' },
            ]}
          >
            {rows.map((row) => (
              <tr key={row.sessionId ?? row.candidateId} className="hover:bg-graphite-50">
                <Td>
                  <Link href={`/candidates/${row.candidateId}`} className="text-accent-700 hover:underline">
                    {row.fullName}
                  </Link>
                </Td>
                <Td>{row.positionTitle}</Td>
                <Td>{row.status === 'COMPLETED' ? 'завершена' : row.status.toLowerCase()}</Td>
                <Td numeric>{formatDateTime(row.completedAt)}</Td>
                <Td numeric align="right">
                  {row.overall === null ? '—' : formatNumber(row.overall, 1)}
                </Td>
                <Td>{row.band ? BAND_LABELS[row.band] : '—'}</Td>
                <Td numeric align="right">
                  {row.confidence === null ? '—' : formatNumber(row.confidence)}
                </Td>
                <Td numeric align="right">
                  {formatPercent(row.coverage)}
                </Td>
                <Td numeric align="right">
                  {row.riskFlagCount}
                </Td>
                <Td>{row.reviewRequired ? <Tag tone="accent">требуется</Tag> : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
