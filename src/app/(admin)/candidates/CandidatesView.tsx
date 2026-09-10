'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, queryString } from '../../../lib/api.js';
import {
  Button,
  Card,
  EmptyState,
  LevelIndicator,
  Notice,
  Select,
  Spinner,
  Table,
  Tag,
  Td,
  TextInput,
} from '../../../components/ui/index.js';
import { BAND_LABELS, formatDateTime, formatNumber, formatPercent } from '../../../lib/format.js';

/** Таблица кандидатов с фильтрами (§26) и полнотекстовым поиском (§57). */

interface Row {
  candidateId: string;
  sessionId: string | null;
  fullName: string;
  positionTitle: string;
  positionCode: string;
  status: string;
  assessmentStatus: string;
  completedAt: string | null;
  overall: number | null;
  band: string | null;
  confidence: number | null;
  coverage: number | null;
  keyCompetencies: Array<{ code: string; title: string; score0to4: number | null; level: number | null }>;
  riskFlagCount: number;
  criticalRiskFlagCount: number;
  reviewRequired: boolean;
  reviewCompletedAt: string | null;
}

interface Filters {
  positionCode: string;
  band: string;
  competencyCode: string;
  riskFlagCode: string;
  minScore: string;
  minConfidence: string;
  status: string;
  reviewRequired: string;
  search: string;
  sort: string;
  order: string;
}

const EMPTY: Filters = {
  positionCode: '',
  band: '',
  competencyCode: '',
  riskFlagCode: '',
  minScore: '',
  minConfidence: '',
  status: '',
  reviewRequired: '',
  search: '',
  sort: 'completedAt',
  order: 'desc',
};

export function CandidatesView() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [positions, setPositions] = useState<Array<{ code: string; title: string }>>([]);
  const [competencies, setCompetencies] = useState<Array<{ code: string; title: string }>>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const [positionResult, competencyResult] = await Promise.all([
        api.get<{ items: Array<{ code: string; title: string }> }>('/api/positions'),
        api.get<{ items: Array<{ code: string; title: string }> }>('/api/competencies'),
      ]);
      setPositions(positionResult.items);
      setCompetencies(competencyResult.items);
    })();
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    const result = await api.get<{ items: Row[]; total: number }>(
      `/api/candidates${queryString({ ...filters, pageSize: 100 })}`,
    );
    setRows(result.items);
    setTotal(result.total);
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card title="Фильтры">
        <div className="grid gap-3 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Должность</label>
            <Select
              value={filters.positionCode}
              onChange={(event) => setFilters({ ...filters, positionCode: event.target.value })}
            >
              <option value="">все</option>
              {positions.map((position) => (
                <option key={position.code} value={position.code}>
                  {position.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Квалификационный уровень</label>
            <Select value={filters.band} onChange={(event) => setFilters({ ...filters, band: event.target.value })}>
              <option value="">любой</option>
              {Object.entries(BAND_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Компетенция</label>
            <Select
              value={filters.competencyCode}
              onChange={(event) => setFilters({ ...filters, competencyCode: event.target.value })}
            >
              <option value="">любая</option>
              {competencies.map((competency) => (
                <option key={competency.code} value={competency.code}>
                  {competency.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Статус сессии</label>
            <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">любой</option>
              <option value="IN_PROGRESS">в процессе</option>
              <option value="COMPLETED">завершена</option>
              <option value="EXPIRED">срок истёк</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Итог не ниже</label>
            <TextInput
              type="number"
              min={0}
              max={100}
              value={filters.minScore}
              onChange={(event) => setFilters({ ...filters, minScore: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Уверенность не ниже</label>
            <TextInput
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={filters.minConfidence}
              onChange={(event) => setFilters({ ...filters, minConfidence: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Экспертная проверка</label>
            <Select
              value={filters.reviewRequired}
              onChange={(event) => setFilters({ ...filters, reviewRequired: event.target.value })}
            >
              <option value="">любая</option>
              <option value="true">требуется</option>
              <option value="false">не требуется</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Поиск по ФИО</label>
            <TextInput
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void load()}>
            Применить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setFilters(EMPTY)}>
            Сбросить
          </Button>
          {selected.length >= 2 && (
            <Link
              href={`/compare?sessions=${selected.join(',')}`}
              className="inline-flex items-center rounded border border-accent-700 bg-accent-700 px-3 py-1.5 text-xs text-white"
            >
              Сравнить выбранных ({selected.length})
            </Link>
          )}
        </div>
      </Card>

      <Card title={`Кандидаты${total ? `: ${total}` : ''}`}>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="Ничего не найдено" description="Измените параметры фильтрации." />
        ) : (
          <>
            <Notice tone="method">
              Сортировка по итоговому баллу не является рейтингом пригодности: сопоставляйте кандидатов
              с учётом покрытия данными и уровня уверенности.
            </Notice>
            <Table
              headers={[
                { label: '' },
                { label: 'ФИО' },
                { label: 'Должность' },
                { label: 'Статус' },
                { label: 'Завершено' },
                { label: 'Итог', align: 'right' },
                { label: 'Уровень' },
                { label: 'Уверенность', align: 'right' },
                { label: 'Покрытие', align: 'right' },
                { label: 'Ключевые компетенции' },
                { label: 'Маркеры', align: 'right' },
                { label: 'Проверка' },
              ]}
            >
              {rows.map((row) => (
                <tr key={row.sessionId ?? row.candidateId} className="hover:bg-graphite-50">
                  <Td>
                    {row.sessionId && (
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${row.fullName} для сравнения`}
                        checked={selected.includes(row.sessionId)}
                        onChange={(event) => {
                          const id = row.sessionId as string;
                          setSelected((previous) =>
                            event.target.checked
                              ? [...previous, id].slice(0, 5)
                              : previous.filter((item) => item !== id),
                          );
                        }}
                        className="h-3.5 w-3.5"
                      />
                    )}
                  </Td>
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
                  <Td className="text-xs">{row.band ? BAND_LABELS[row.band] : '—'}</Td>
                  <Td numeric align="right">
                    {formatNumber(row.confidence)}
                  </Td>
                  <Td numeric align="right">
                    {formatPercent(row.coverage)}
                  </Td>
                  <Td>
                    <ul className="space-y-0.5">
                      {row.keyCompetencies.map((competency) => (
                        <li key={competency.code} className="flex items-center gap-2 text-2xs">
                          <span className="w-40 truncate text-graphite-600">{competency.title}</span>
                          <LevelIndicator score={competency.score0to4} level={competency.level} />
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td numeric align="right">
                    {row.riskFlagCount}
                    {row.criticalRiskFlagCount > 0 && (
                      <span className="ml-1 text-2xs text-graphite-500">({row.criticalRiskFlagCount} выс.)</span>
                    )}
                  </Td>
                  <Td>
                    {row.reviewCompletedAt ? (
                      <Tag>выполнена</Tag>
                    ) : row.reviewRequired ? (
                      <Tag tone="accent">требуется</Tag>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
