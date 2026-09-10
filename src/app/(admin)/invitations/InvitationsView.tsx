'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../../lib/api.js';
import {
  Button,
  Card,
  EmptyState,
  FilterField,
  Notice,
  Select,
  Spinner,
  Table,
  Tag,
  Td,
  TextInput,
} from '../../../components/ui/index.js';
import { STATUS_LABELS, formatDateTime } from '../../../lib/format.js';

/** Приглашения (§54): создание, выдача одноразовой ссылки, статусы. */

interface Invitation {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  candidate: { id: string; fullName: string; email: string | null; position: { title: string; code: string } };
  version: { id: string; version: number; assessment: { title: string } };
  sessions: Array<{ id: string; status: string; assessmentStatus: string; completedAt: string | null }>;
  createdBy: { fullName: string };
}

interface VersionOption {
  id: string;
  version: number;
  assessment: { title: string; position: { code: string; title: string } };
}

export function InvitationsView() {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    assessmentVersionId: '',
    expiresAt: '',
    experienceYears: '',
    sourceChannel: '',
  });

  const load = useCallback(async () => {
    const [list, versionResult] = await Promise.all([
      api.get<{ items: Invitation[] }>('/api/invitations?pageSize=100'),
      api.get<{ items: VersionOption[] }>('/api/assessment-versions'),
    ]);
    setItems(list.items);
    setVersions(versionResult.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setIssuedLink(null);
    try {
      const version = versions.find((item) => item.id === form.assessmentVersionId);
      if (!version) throw new Error('Выберите версию ассессмента');
      const result = await api.post<{ invitation: { url: string } }>('/api/invitations', {
        fullName: form.fullName,
        ...(form.email ? { email: form.email } : {}),
        positionCode: version.assessment.position.code,
        assessmentVersionId: form.assessmentVersionId,
        expiresAt: new Date(form.expiresAt).toISOString(),
        ...(form.experienceYears ? { experienceYears: Number(form.experienceYears) } : {}),
        ...(form.sourceChannel ? { sourceChannel: form.sourceChannel } : {}),
      });
      setIssuedLink(result.invitation.url);
      setForm({ ...form, fullName: '', email: '', experienceYears: '' });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : 'Ошибка создания',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <Spinner label="Загрузка приглашений" />;

  return (
    <div className="space-y-5">
      <Card title="Новое приглашение">
        {error && <Notice tone="tech">{error}</Notice>}
        {issuedLink && (
          <Notice tone="method" title="Ссылка сформирована">
            Ссылка отображается один раз и не хранится в открытом виде. Передайте её кандидату.
            <div className="mt-1.5 break-all rounded border border-graphite-300 bg-white px-2 py-1.5 font-mono text-2xs">
              {issuedLink}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-1.5"
              onClick={() => void navigator.clipboard.writeText(issuedLink)}
            >
              Скопировать
            </Button>
          </Notice>
        )}
        <div className="grid gap-3 lg:grid-cols-3">
          <FilterField label="ФИО кандидата">
            {({ id }) => (
              <TextInput
                id={id}
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
            )}
          </FilterField>
          <FilterField label="Электронная почта">
            {({ id }) => (
              <TextInput
                id={id}
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            )}
          </FilterField>
          <FilterField label="Версия ассессмента">
            {({ id }) => (
              <Select
                id={id}
                value={form.assessmentVersionId}
                onChange={(event) => setForm({ ...form, assessmentVersionId: event.target.value })}
              >
                <option value="">выберите</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.assessment.position.title} — {version.assessment.title}, в. {version.version}
                  </option>
                ))}
              </Select>
            )}
          </FilterField>
          <FilterField label="Срок прохождения">
            {({ id }) => (
              <TextInput
                id={id}
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
              />
            )}
          </FilterField>
          <FilterField label="Стаж, лет">
            {({ id }) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                max={70}
                value={form.experienceYears}
                onChange={(event) => setForm({ ...form, experienceYears: event.target.value })}
              />
            )}
          </FilterField>
          <FilterField label="Источник кандидата">
            {({ id }) => (
              <TextInput
                id={id}
                value={form.sourceChannel}
                onChange={(event) => setForm({ ...form, sourceChannel: event.target.value })}
              />
            )}
          </FilterField>
        </div>
        <Notice tone="method">
          Собираются только профессиональные данные. Пол, возраст, национальность, вероисповедание,
          семейное положение и данные здоровья не запрашиваются и в оценке не используются.
        </Notice>
        <Button
          onClick={() => void create()}
          disabled={busy || !form.fullName || !form.assessmentVersionId || !form.expiresAt}
        >
          {busy ? 'Создание…' : 'Создать приглашение'}
        </Button>
      </Card>

      <Card title={`Приглашения: ${items.length}`}>
        {items.length === 0 ? (
          <EmptyState title="Приглашений пока нет" />
        ) : (
          <Table
            headers={[
              { label: 'ФИО' },
              { label: 'Должность' },
              { label: 'Ассессмент' },
              { label: 'Статус' },
              { label: 'Создано' },
              { label: 'Срок' },
              { label: 'Автор' },
              { label: '' },
            ]}
          >
            {items.map((invitation) => (
              <tr key={invitation.id} className="hover:bg-graphite-50">
                <Td>{invitation.candidate.fullName}</Td>
                <Td>{invitation.candidate.position.title}</Td>
                <Td className="text-xs">
                  {invitation.version.assessment.title}, в. {invitation.version.version}
                </Td>
                <Td>
                  <Tag tone={invitation.status === 'COMPLETED' ? 'accent' : 'neutral'}>
                    {STATUS_LABELS[invitation.status] ?? invitation.status}
                  </Tag>
                </Td>
                <Td numeric>{formatDateTime(invitation.createdAt)}</Td>
                <Td numeric>{formatDateTime(invitation.expiresAt)}</Td>
                <Td className="text-xs">{invitation.createdBy.fullName}</Td>
                <Td>
                  {invitation.status !== 'COMPLETED' && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const result = await api.post<{ url: string }>(
                            `/api/invitations/${invitation.id}/resend`,
                            {},
                          );
                          setIssuedLink(result.url);
                          await load();
                        }}
                      >
                        Перевыпустить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await api.post(`/api/invitations/${invitation.id}/cancel`);
                          await load();
                        }}
                      >
                        Отозвать
                      </Button>
                    </div>
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
