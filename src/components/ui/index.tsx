'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Примитивы интерфейса. Корпоративный инженерный стиль: плотные таблицы,
 * табулярные числа, отсутствие игровых элементов.
 *
 * `danger` применяется только к техническим предупреждениям (ошибка
 * сохранения, истёкшая сессия), но не к оценке кандидата.
 */

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  onClick,
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded border font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-50';
  const variants: Record<string, string> = {
    primary: 'border-accent-700 bg-accent-700 text-white hover:bg-accent-800',
    secondary: 'border-graphite-300 bg-white text-graphite-800 hover:bg-graphite-100',
    ghost: 'border-transparent bg-transparent text-graphite-700 hover:bg-graphite-100',
    danger: 'border-danger-700 bg-white text-danger-700 hover:bg-danger-50',
  };
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded border border-graphite-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-graphite-200 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-graphite-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-graphite-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-graphite-800">
        {label}
        {required && <span className="ml-1 text-graphite-400">*</span>}
      </label>
      {hint && (
        <p id={hintId} className="mb-1 text-xs text-graphite-500">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT_CLASS =
  'w-full rounded border border-graphite-300 bg-white px-3 py-2 text-sm text-graphite-900 ' +
  'placeholder:text-graphite-400 focus:border-accent-600';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${INPUT_CLASS} min-h-[8rem] leading-relaxed ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />;
}

export function Table({
  headers,
  children,
  dense = true,
  caption,
}: {
  headers: Array<{ label: string; align?: 'left' | 'right' | 'center'; width?: string }>;
  children: ReactNode;
  dense?: boolean;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-graphite-300 bg-graphite-50">
            {headers.map((header) => (
              <th
                key={header.label}
                scope="col"
                style={header.width ? { width: header.width } : undefined}
                className={`${dense ? 'px-2.5 py-2' : 'px-3 py-2.5'} text-${header.align ?? 'left'} text-xs font-semibold uppercase tracking-wide text-graphite-600`}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-graphite-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = 'left',
  numeric = false,
  className = '',
  colSpan,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  numeric?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-2.5 py-2 align-top text-${align} ${numeric ? 'tnum whitespace-nowrap' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/** Нейтральная метка. Не используется как цветовой приговор кандидату. */
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'tech' }) {
  const tones: Record<string, string> = {
    neutral: 'border-graphite-300 text-graphite-700',
    accent: 'border-accent-300 bg-accent-50 text-accent-800',
    tech: 'border-warnTech-500 bg-warnTech-50 text-warnTech-500',
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Шкала уровня 0..4: насыщенность акцента и подпись, без «светофора». */
export function LevelIndicator({
  score,
  level,
  levelTitle,
  notEnoughEvidence,
}: {
  score: number | null;
  level: number | null;
  levelTitle?: string | null;
  notEnoughEvidence?: boolean;
}) {
  if (notEnoughEvidence || score === null) {
    return <span className="text-xs italic text-graphite-500">недостаточно данных</span>;
  }
  const width = Math.max(2, Math.round((score / 4) * 100));
  const shade = level === null ? 2 : Math.min(4, Math.max(0, level));
  const colors = ['bg-level-0', 'bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4'];
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 shrink-0 overflow-hidden rounded-sm bg-graphite-200" aria-hidden="true">
        <span className={`block h-full ${colors[shade]}`} style={{ width: `${width}%` }} />
      </span>
      <span className="tnum text-xs text-graphite-800">
        {score.toFixed(2)}
        {levelTitle ? ` · ${levelTitle}` : ''}
      </span>
    </span>
  );
}

export function Notice({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode;
  tone?: 'info' | 'method' | 'tech';
  title?: string;
}) {
  const tones: Record<string, string> = {
    info: 'border-l-graphite-400 bg-graphite-50 text-graphite-700',
    method: 'border-l-accent-500 bg-accent-50 text-graphite-800',
    tech: 'border-l-warnTech-500 bg-warnTech-50 text-graphite-800',
  };
  return (
    <div className={`mb-3 border-l-2 px-3 py-2 text-xs leading-relaxed ${tones[tone]}`} role="note">
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children}
    </div>
  );
}

/** Техническое предупреждение — единственное место применения красного. */
export function TechError({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 border-l-2 border-l-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-700" role="alert">
      {children}
    </div>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-graphite-600">
        <span>{label ?? 'Прогресс'}</span>
        <span className="tnum">{percent}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-sm bg-graphite-200"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-accent-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-medium text-graphite-700">{title}</p>
      {description && <p className="mt-1 text-xs text-graphite-500">{description}</p>}
    </div>
  );
}

export function Spinner({ label = 'Загрузка' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-graphite-500" role="status">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-graphite-300 border-t-accent-600"
        aria-hidden="true"
      />
      {label}…
    </div>
  );
}

/**
 * Переключатель «График / Таблица». Требование §52: у каждого графика
 * обязателен табличный эквивалент.
 */
export function ChartWithTable({
  title,
  chart,
  table,
  note,
  defaultView = 'chart',
}: {
  title: string;
  chart: ReactNode;
  table: ReactNode;
  note?: string;
  defaultView?: 'chart' | 'table';
}) {
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  return (
    <Card
      title={title}
      actions={
        <div className="flex rounded border border-graphite-300 text-xs" role="group" aria-label="Способ отображения">
          <button
            type="button"
            onClick={() => setView('chart')}
            aria-pressed={view === 'chart'}
            className={`px-2 py-1 ${view === 'chart' ? 'bg-graphite-800 text-white' : 'text-graphite-700'}`}
          >
            График
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            className={`px-2 py-1 ${view === 'table' ? 'bg-graphite-800 text-white' : 'text-graphite-700'}`}
          >
            Таблица
          </button>
        </div>
      }
    >
      {note && <Notice tone="method">{note}</Notice>}
      {view === 'chart' ? chart : table}
    </Card>
  );
}

export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(10rem,auto)_1fr]">
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-xs text-graphite-500">{item.term}</dt>
          <dd className="text-sm text-graphite-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
