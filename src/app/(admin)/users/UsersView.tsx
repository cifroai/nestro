'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../../lib/api.js';
import {
  Button,
  Card,
  FilterField,
  Notice,
  Spinner,
  Table,
  Tag,
  Td,
  TextInput,
} from '../../../components/ui/index.js';
import { formatDateTime } from '../../../lib/format.js';

/** Управление пользователями и ролями (§42). */

const ROLE_TITLES: Record<string, string> = {
  SuperAdmin: 'Суперадминистратор',
  AssessmentAdmin: 'Администратор ассессментов',
  HR: 'HR-специалист',
  TechnicalExpert: 'Технический эксперт',
  Viewer: 'Наблюдатель',
};

const ASSIGNABLE = Object.keys(ROLE_TITLES);

interface UserItem {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: Array<{ role: { code: string; title: string } }>;
}

export function UsersView() {
  const [items, setItems] = useState<UserItem[] | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', roleCodes: ['Viewer'] as string[] });
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api.get<{ items: UserItem[] }>('/api/users');
    setItems(result.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <Spinner label="Загрузка пользователей" />;

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const result = await api.post<{ generatedPassword: string | null }>('/api/users', form);
      setIssued(result.generatedPassword);
      setForm({ email: '', fullName: '', roleCodes: ['Viewer'] });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось создать пользователя');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Новый пользователь">
        {error && <Notice tone="tech">{error}</Notice>}
        {issued && (
          <Notice tone="method" title="Пароль сформирован">
            Пароль отображается один раз. Передайте его пользователю защищённым каналом.
            <div className="mt-1.5 rounded border border-graphite-300 bg-white px-2 py-1.5 font-mono text-xs">
              {issued}
            </div>
          </Notice>
        )}
        <div className="grid gap-3 lg:grid-cols-3">
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
          <FilterField label="ФИО">
            {({ id }) => (
              <TextInput
                id={id}
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
            )}
          </FilterField>
          <fieldset>
            {/* Набор ролей — группа переключателей, поэтому подпись оформлена
                легендой: htmlFor к группе кнопок неприменим. */}
            <legend className="mb-1 block text-2xs uppercase text-graphite-500">Роли</legend>
            <div className="flex flex-wrap gap-1.5">
              {ASSIGNABLE.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      roleCodes: form.roleCodes.includes(role)
                        ? form.roleCodes.filter((item) => item !== role)
                        : [...form.roleCodes, role],
                    })
                  }
                  aria-pressed={form.roleCodes.includes(role)}
                  className={`rounded border px-2 py-1 text-2xs ${
                    form.roleCodes.includes(role)
                      ? 'border-accent-700 bg-accent-700 text-white'
                      : 'border-graphite-300 bg-white text-graphite-700'
                  }`}
                >
                  {ROLE_TITLES[role]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <Notice tone="method">
          Роль «Кандидат» сотрудникам не назначается: кандидаты проходят тестирование
          по одноразовой ссылке без учётной записи.
        </Notice>
        <Button
          onClick={() => void create()}
          disabled={busy || !form.email || !form.fullName || form.roleCodes.length === 0}
        >
          {busy ? 'Создание…' : 'Создать пользователя'}
        </Button>
      </Card>

      <Card title={`Пользователи: ${items.length}`}>
        <Table
          headers={[
            { label: 'ФИО' },
            { label: 'Электронная почта' },
            { label: 'Роли' },
            { label: 'Активен' },
            { label: 'Последний вход' },
            { label: '' },
          ]}
        >
          {items.map((user) => (
            <tr key={user.id}>
              <Td>{user.fullName}</Td>
              <Td className="font-mono text-2xs">{user.email}</Td>
              <Td className="text-xs">{user.roles.map((item) => item.role.title).join(', ')}</Td>
              <Td>{user.isActive ? <Tag tone="accent">да</Tag> : <Tag>нет</Tag>}</Td>
              <Td numeric>{formatDateTime(user.lastLoginAt)}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.patch(`/api/users/${user.id}/active`, { isActive: !user.isActive });
                      await load();
                    }}
                  >
                    {user.isActive ? 'Деактивировать' : 'Активировать'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const result = await api.post<{ password: string }>(`/api/users/${user.id}/password`);
                      setIssued(result.password);
                      await load();
                    }}
                  >
                    Сбросить пароль
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
