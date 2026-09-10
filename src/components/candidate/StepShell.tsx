'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Notice, ProgressBar, TechError } from '../ui/index.js';
import { SECTION_LABELS } from '../../lib/format.js';

/**
 * Общая оболочка шага прохождения теста.
 *
 * Обеспечивает: индикацию сохранения, телеметрию (время показа, первый ввод,
 * активное время), восстановление после разрыва соединения. Кандидату не
 * показываются баллы и внутренние оценки (§75).
 */

export interface Telemetry {
  shownAt: string;
  firstInputAt?: string;
  msActive: number;
  focusLossCount: number;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useTelemetry(stepKey: string): {
  telemetry: () => Telemetry;
  markInput: () => void;
} {
  const shownAt = useRef<string>(new Date().toISOString());
  const firstInputAt = useRef<string | undefined>(undefined);
  const activeMs = useRef(0);
  const lastTick = useRef(Date.now());
  const focusLoss = useRef(0);

  useEffect(() => {
    shownAt.current = new Date().toISOString();
    firstInputAt.current = undefined;
    activeMs.current = 0;
    lastTick.current = Date.now();
    focusLoss.current = 0;
  }, [stepKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        activeMs.current += Date.now() - lastTick.current;
      }
      lastTick.current = Date.now();
    }, 1000);

    const onVisibility = (): void => {
      // Переключение вкладки фиксируется как технический факт (§24).
      if (document.visibilityState === 'hidden') focusLoss.current += 1;
      lastTick.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return {
    telemetry: () => ({
      shownAt: shownAt.current,
      ...(firstInputAt.current ? { firstInputAt: firstInputAt.current } : {}),
      msActive: activeMs.current,
      focusLossCount: focusLoss.current,
    }),
    markInput: () => {
      firstInputAt.current ??= new Date().toISOString();
    },
  };
}

export function SaveIndicator({ state, error }: { state: SaveState; error?: string | null }) {
  if (state === 'error') {
    return <TechError>Не удалось сохранить ответ: {error ?? 'проверьте соединение'}. Повторите отправку.</TechError>;
  }
  const labels: Record<SaveState, string> = {
    idle: 'Черновик сохраняется автоматически',
    saving: 'Сохранение…',
    saved: 'Черновик сохранён на сервере',
    error: '',
  };
  return <p className="text-2xs text-graphite-500">{labels[state]}</p>;
}

export function StepShell({
  section,
  title,
  description,
  progressPercent,
  sections,
  children,
  footer,
  saveState,
  saveError,
}: {
  section: string;
  title: string;
  description?: ReactNode;
  progressPercent: number;
  sections: Array<{ section: string; completed: number; total: number }>;
  children: ReactNode;
  footer?: ReactNode;
  saveState?: SaveState;
  saveError?: string | null;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-5">
        <ProgressBar percent={progressPercent} label={SECTION_LABELS[section] ?? section} />
        <nav aria-label="Разделы тестирования" className="mt-3 flex flex-wrap gap-1.5">
          {sections
            .filter((item) => item.total > 0)
            .map((item) => {
              const done = item.completed >= item.total;
              const current = item.section === section;
              return (
                <span
                  key={item.section}
                  className={`rounded border px-2 py-0.5 text-2xs ${
                    current
                      ? 'border-accent-600 bg-accent-50 text-accent-800'
                      : done
                        ? 'border-graphite-300 bg-graphite-100 text-graphite-600'
                        : 'border-graphite-200 text-graphite-500'
                  }`}
                >
                  {SECTION_LABELS[item.section] ?? item.section} {item.completed}/{item.total}
                </span>
              );
            })}
        </nav>
      </header>

      <main id="main">
        <h1 className="mb-2 text-lg font-semibold text-graphite-900">{title}</h1>
        {description && <div className="mb-4 text-sm leading-relaxed text-graphite-700">{description}</div>}
        {children}
      </main>

      <footer className="mt-6 flex flex-col gap-3 border-t border-graphite-200 pt-4">
        {saveState && <SaveIndicator state={saveState} error={saveError} />}
        {footer}
      </footer>
    </div>
  );
}

/**
 * Поле открытого ответа с индикацией минимальной длины.
 * Минимальная длина — методическое требование к полноте ответа, а не оценка.
 */
export function AnswerField({
  label,
  hint,
  value,
  minLength,
  onChange,
  rows = 4,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  minLength?: number;
  onChange: (value: string) => void;
  rows?: number;
  error?: string | null;
}) {
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const statusId = `${fieldId}-status`;
  const length = value.trim().length;
  const tooShort = minLength !== undefined && length > 0 && length < minLength;
  const empty = touched && length === 0;
  const statusText =
    error ?? (empty ? 'Поле обязательно для заполнения' : tooShort ? `Ещё ${minLength! - length} симв.` : '');

  // Подпись связана с полем через htmlFor/id: без этого программы экранного
  // доступа не сообщают кандидату, что именно он заполняет.
  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-graphite-800">
        {label}
        {minLength ? <span className="ml-1 font-normal text-graphite-400">не менее {minLength} симв.</span> : null}
      </label>
      {hint && (
        <p id={hintId} className="mb-1 text-xs text-graphite-500">
          {hint}
        </p>
      )}
      <textarea
        id={fieldId}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={tooShort || empty || Boolean(error)}
        aria-describedby={[hint ? hintId : null, statusText ? statusId : null].filter(Boolean).join(' ') || undefined}
        className="w-full rounded border border-graphite-300 bg-white px-3 py-2 text-sm leading-relaxed text-graphite-900 focus:border-accent-600"
      />
      <div className="mt-1 flex items-baseline justify-between text-2xs">
        <span id={statusId} className={tooShort || empty || error ? 'text-danger-700' : 'text-graphite-400'}>
          {statusText}
        </span>
        <span className="tnum text-graphite-400">{length}</span>
      </div>
    </div>
  );
}

export function StepActions({
  onSubmit,
  disabled,
  submitting,
  label = 'Далее',
  secondary,
}: {
  onSubmit: () => void;
  disabled?: boolean;
  submitting?: boolean;
  label?: string;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>{secondary}</div>
      <Button size="lg" onClick={onSubmit} disabled={disabled || submitting}>
        {submitting ? 'Отправка…' : label}
      </Button>
    </div>
  );
}

export function AntiPrimingNotice() {
  return (
    <Notice tone="method">
      Формулируйте критерий своими словами. Примеры готовых формулировок не приводятся намеренно:
      важно получить именно ваши профессиональные критерии.
    </Notice>
  );
}
