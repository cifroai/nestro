'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, queryString } from '../../../lib/api.js';
import {
  Button,
  Card,
  EmptyState,
  Notice,
  Spinner,
  Table,
  Td,
  TextInput,
} from '../../../components/ui/index.js';
import { formatDateTime } from '../../../lib/format.js';

/** Журнал аудита (§43): кто, когда, что изменил, старое и новое значение. */

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorKind: string;
  actorLabel: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}

export function AuditView() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ entity: '', action: '', entityId: '' });

  const load = useCallback(async () => {
    setItems(null);
    const result = await api.get<{ items: AuditEntry[]; total: number }>(
      `/api/audit${queryString({ ...filters, pageSize: 100 })}`,
    );
    setItems(result.items);
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
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Сущность</label>
            <TextInput
              value={filters.entity}
              placeholder="AssessmentVersion, HumanReview…"
              onChange={(event) => setFilters({ ...filters, entity: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Действие содержит</label>
            <TextInput
              value={filters.action}
              placeholder="weights, review, scoring…"
              onChange={(event) => setFilters({ ...filters, action: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Идентификатор объекта</label>
            <TextInput
              value={filters.entityId}
              onChange={(event) => setFilters({ ...filters, entityId: event.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={() => void load()}>
              Применить
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`Записи журнала: ${total}`}>
        <Notice tone="method">
          Журнал аудита неизменяем: записи только добавляются. Фиксируются изменения весов, rubric,
          оценок кандидатов, результатов экспертной проверки, версий ассессмента, прав доступа
          и выгрузок персональных данных.
        </Notice>
        {!items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="Записей не найдено" />
        ) : (
          <Table
            headers={[
              { label: 'Дата' },
              { label: 'Кто' },
              { label: 'Действие' },
              { label: 'Объект' },
              { label: 'Было' },
              { label: 'Стало' },
              { label: 'IP' },
            ]}
          >
            {items.map((entry) => (
              <tr key={entry.id} className="align-top">
                <Td numeric>{formatDateTime(entry.createdAt)}</Td>
                <Td className="text-xs">
                  {entry.actor?.fullName ?? entry.actorLabel ?? entry.actorKind}
                  <div className="text-2xs text-graphite-400">{entry.actorKind}</div>
                </Td>
                <Td className="font-mono text-2xs">{entry.action}</Td>
                <Td className="text-2xs">
                  {entry.entity}
                  {entry.entityId && <div className="font-mono text-graphite-400">{entry.entityId}</div>}
                </Td>
                <Td>
                  <ValuePreview value={entry.oldValue} />
                </Td>
                <Td>
                  <ValuePreview value={entry.newValue} />
                </Td>
                <Td className="font-mono text-2xs">{entry.ip ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function ValuePreview({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-graphite-400">—</span>;
  const text = JSON.stringify(value, null, 1);
  if (text.length <= 120) {
    return <pre className="whitespace-pre-wrap break-all text-2xs text-graphite-700">{text}</pre>;
  }
  return (
    <details>
      <summary className="cursor-pointer text-2xs text-accent-700">показать ({text.length} симв.)</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-2xs text-graphite-700">
        {text}
      </pre>
    </details>
  );
}
