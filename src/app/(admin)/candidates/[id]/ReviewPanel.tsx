'use client';

import { useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../../../lib/api.js';
import { Button, Notice, TechError } from '../../../../components/ui/index.js';
import { LEVEL_LABELS } from '../../../../lib/format.js';

/**
 * Панель экспертной проверки (§29).
 * Причина изменения обязательна: она попадает в отчёт и в журнал аудита.
 */

interface Competency {
  code: string;
  id: string;
}

export function ReviewPanel({
  answerId,
  competencyCode,
  modelScore,
  onSubmitted,
}: {
  answerId: string;
  competencyCode: string;
  modelScore: number | null;
  onSubmitted: () => Promise<void>;
}) {
  const [competencyId, setCompetencyId] = useState<string | null>(null);
  const [humanScore, setHumanScore] = useState<number | null>(modelScore === null ? null : Math.round(modelScore));
  const [uninformative, setUninformative] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ items: Competency[] }>('/api/competencies');
      setCompetencyId(result.items.find((item) => item.code === competencyCode)?.id ?? null);
    })();
  }, [competencyCode]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/reviews', {
        answerId,
        competencyId,
        humanScore: uninformative ? null : humanScore,
        markedUninformative: uninformative,
        reviewReason: reason,
      });
      setDone(true);
      await onSubmitted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Не удалось сохранить оценку');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <Notice tone="info">Экспертная оценка сохранена, итоги пересчитаны.</Notice>;
  }

  const ready = competencyId !== null && reason.trim().length >= 20 && (uninformative || humanScore !== null);

  return (
    <div className="mt-3 rounded border border-accent-200 bg-accent-50 px-3 py-2.5">
      <div className="mb-2 text-xs font-semibold text-graphite-800">Экспертная оценка</div>
      {error && <TechError>{error}</TechError>}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {[0, 1, 2, 3, 4].map((level) => (
          <button
            key={level}
            type="button"
            disabled={uninformative}
            onClick={() => setHumanScore(level)}
            aria-pressed={humanScore === level}
            className={`rounded border px-2 py-1 text-2xs ${
              humanScore === level && !uninformative
                ? 'border-accent-700 bg-accent-700 text-white'
                : 'border-graphite-300 bg-white text-graphite-700'
            } ${uninformative ? 'opacity-50' : ''}`}
          >
            {level} — {LEVEL_LABELS[level]}
          </button>
        ))}
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs text-graphite-700">
        <input
          type="checkbox"
          checked={uninformative}
          onChange={(event) => setUninformative(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        Ответ недостаточно информативен (значение «недостаточно данных», не ноль)
      </label>

      <textarea
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Причина изменения или подтверждения оценки (не менее 20 символов). Попадает в отчёт и журнал аудита."
        className="mb-2 w-full rounded border border-graphite-300 px-2.5 py-2 text-xs"
      />

      <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>
        {busy ? 'Сохранение…' : 'Сохранить оценку эксперта'}
      </Button>
    </div>
  );
}
