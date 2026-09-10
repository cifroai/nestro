'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, api, setCsrfToken } from '../../../lib/api.js';
import { Button, Card, Notice, Spinner, Table, Td, TechError } from '../../../components/ui/index.js';
import { formatDateTime } from '../../../lib/format.js';

/**
 * Страница приглашения (§25): должность, структура теста, правила, дедлайн,
 * согласие на обработку данных. Никаких результатов оценки здесь нет.
 */

interface InvitationView {
  invitationId: string;
  positionTitle: string;
  positionDescription: string | null;
  assessmentTitle: string;
  expiresAt: string;
  status: string;
  candidateName: string;
  structure: Array<{ section: string; title: string; description: string; approxMinutes: number }>;
  totalApproxMinutes: number;
  rules: string[];
  attemptsLeft: number;
  existingSessionId: string | null;
}

export function InvitePage({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setInvitation(await api.get<InvitationView>(`/api/invite/${token}`));
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Не удалось загрузить приглашение. Проверьте ссылку и соединение.',
        );
      }
    })();
  }, [token]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.post<{ sessionId: string; csrfToken: string | null }>(
        '/api/sessions/start',
        { token },
      );
      setCsrfToken(result.csrfToken);
      router.push(`/t/${result.sessionId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось начать тестирование.');
      setStarting(false);
    }
  }, [token, router]);

  if (error && !invitation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <TechError>{error}</TechError>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Spinner label="Загрузка приглашения" />
      </div>
    );
  }

  const completed = invitation.status === 'COMPLETED';

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 border-b border-graphite-300 pb-4">
        <p className="text-xs uppercase tracking-wide text-graphite-500">Профессиональная оценка</p>
        <h1 className="mt-1 text-xl font-semibold text-graphite-900">{invitation.positionTitle}</h1>
        <p className="mt-1 text-sm text-graphite-600">{invitation.assessmentTitle}</p>
      </header>

      {error && <TechError>{error}</TechError>}

      {completed ? (
        <Card title="Тестирование завершено">
          <p className="text-sm text-graphite-700">
            Ответы по этому приглашению уже отправлены. Повторное прохождение недоступно.
          </p>
        </Card>
      ) : (
        <>
          <Card title="Кому адресовано приглашение" className="mb-4">
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-graphite-500">Кандидат</dt>
              <dd>{invitation.candidateName}</dd>
              <dt className="text-graphite-500">Срок прохождения</dt>
              <dd className="tnum">{formatDateTime(invitation.expiresAt)}</dd>
              <dt className="text-graphite-500">Ориентировочная длительность</dt>
              <dd className="tnum">около {Math.round(invitation.totalApproxMinutes / 60)} ч</dd>
              <dt className="text-graphite-500">Доступных попыток</dt>
              <dd className="tnum">{invitation.attemptsLeft}</dd>
            </dl>
          </Card>

          {invitation.positionDescription && (
            <Card title="О должности" className="mb-4">
              <p className="text-sm leading-relaxed text-graphite-700">{invitation.positionDescription}</p>
            </Card>
          )}

          <Card title="Структура тестирования" className="mb-4">
            <Table
              headers={[
                { label: 'Раздел' },
                { label: 'Содержание' },
                { label: 'Ориентировочно, мин', align: 'right' },
              ]}
              caption="Ориентировочная структура тестирования"
            >
              {invitation.structure.map((item) => (
                <tr key={item.section}>
                  <Td className="font-medium">{item.title}</Td>
                  <Td>{item.description}</Td>
                  <Td numeric align="right">
                    {item.approxMinutes}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Правила прохождения" className="mb-4">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-graphite-700">
              {invitation.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </Card>

          <Notice tone="method" title="Обработка данных">
            Собираются только профессиональные данные, необходимые для оценки квалификации:
            ответы на вопросы и сформулированные вами критерии. Возраст, пол, национальность,
            вероисповедание, политические убеждения, данные здоровья и семейное положение
            не запрашиваются и в оценке не используются. Доступ к веб-камере и микрофону
            не запрашивается.
          </Notice>

          <label className="mb-5 flex items-start gap-2.5 text-sm text-graphite-800">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-graphite-400"
            />
            <span>
              Я подтверждаю согласие на обработку предоставленных профессиональных данных
              в рамках процедуры оценки квалификации.
            </span>
          </label>

          <Button size="lg" onClick={() => void start()} disabled={!consent || starting}>
            {starting
              ? 'Подготовка…'
              : invitation.existingSessionId
                ? 'Продолжить тестирование'
                : 'Начать тестирование'}
          </Button>
        </>
      )}
    </main>
  );
}
