'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';
import { Card, EmptyState, Notice, Spinner, Table, Tag, Td } from '../../../components/ui/index.js';
import { BAND_LABELS, formatDateTime, formatNumber, formatPercent } from '../../../lib/format.js';

/** Очередь экспертной проверки (§26): расхождения, низкая уверенность, hard-gates. */

interface QueueItem {
  id: string;
  completedAt: string | null;
  reviewRequired: boolean;
  candidate: { id: string; fullName: string; position: { title: string; code: string } };
  version: { version: number; assessment: { title: string } };
  finalScores: Array<{ score0to100: number | null; band: string | null; confidence: number; coverage: number | null }>;
  riskFlags: Array<{ code: string; severity: string }>;
  _count: { answers: number };
}

export function ReviewQueueView() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ items: QueueItem[]; total: number }>('/api/reviews/queue?pageSize=50');
      setItems(result.items);
      setTotal(result.total);
    })();
  }, []);

  if (!items) return <Spinner label="Загрузка очереди" />;

  return (
    <Card title={`Требует экспертной проверки: ${total}`}>
      <Notice tone="method">
        В очередь попадают сессии с расхождением оценщиков, низкой уверенностью вывода,
        критическими компетенциями и непроверенными доказательствами. Проверка эксперта
        перекрывает модельную оценку и фиксируется в журнале аудита.
      </Notice>
      {items.length === 0 ? (
        <EmptyState title="Очередь пуста" description="Все завершённые сессии проверены." />
      ) : (
        <Table
          headers={[
            { label: 'ФИО' },
            { label: 'Должность' },
            { label: 'Ассессмент' },
            { label: 'Завершено' },
            { label: 'Итог', align: 'right' },
            { label: 'Уровень' },
            { label: 'Уверенность', align: 'right' },
            { label: 'Покрытие', align: 'right' },
            { label: 'Ответов', align: 'right' },
            { label: 'Маркеры', align: 'right' },
          ]}
        >
          {items.map((item) => {
            const score = item.finalScores[0];
            const high = item.riskFlags.filter((flag) => flag.severity === 'HIGH').length;
            return (
              <tr key={item.id} className="hover:bg-graphite-50">
                <Td>
                  <Link href={`/candidates/${item.candidate.id}`} className="text-accent-700 hover:underline">
                    {item.candidate.fullName}
                  </Link>
                </Td>
                <Td>{item.candidate.position.title}</Td>
                <Td className="text-xs">
                  {item.version.assessment.title}, в. {item.version.version}
                </Td>
                <Td numeric>{formatDateTime(item.completedAt)}</Td>
                <Td numeric align="right">
                  {score?.score0to100 === null || score === undefined ? '—' : formatNumber(score.score0to100, 1)}
                </Td>
                <Td className="text-xs">{score?.band ? BAND_LABELS[score.band] : '—'}</Td>
                <Td numeric align="right">
                  {score ? formatNumber(score.confidence) : '—'}
                </Td>
                <Td numeric align="right">
                  {score ? formatPercent(score.coverage) : '—'}
                </Td>
                <Td numeric align="right">
                  {item._count.answers}
                </Td>
                <Td numeric align="right">
                  {item.riskFlags.length}
                  {high > 0 && <span className="ml-1"><Tag tone="accent">{high} выс.</Tag></span>}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}
