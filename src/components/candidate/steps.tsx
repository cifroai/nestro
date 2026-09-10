'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Notice, Table, Td } from '../ui/index.js';
import { LineChart } from '../charts/index.js';
import { AnswerField, AntiPrimingNotice, StepActions } from './StepShell.js';

/**
 * Шаги прохождения теста. Каждый компонент отвечает только за представление
 * и сбор значения; сохранение и логика перехода — на уровне страницы.
 */

// ─── Триада Келли ────────────────────────────────────────────────────────────

export interface TriadPayload {
  triadCode: string;
  question: { prompt: string; helpText: string | null; subFields: unknown };
  elements: Array<{ code: string; label: string; description: string | null }>;
  index: number;
  total: number;
}

export interface TriadValue {
  similarPair: string[];
  similarity: string;
  difference: string;
  poleLeft: string;
  poleRight: string;
  importanceReason: string;
  rigManifestation: string;
  experienceExample: string;
}

export const EMPTY_TRIAD: TriadValue = {
  similarPair: [],
  similarity: '',
  difference: '',
  poleLeft: '',
  poleRight: '',
  importanceReason: '',
  rigManifestation: '',
  experienceExample: '',
};

const TRIAD_MIN = {
  similarity: 40,
  difference: 40,
  poleLeft: 8,
  poleRight: 8,
  importanceReason: 40,
  rigManifestation: 40,
  experienceExample: 80,
};

export function triadReady(value: TriadValue): boolean {
  if (value.similarPair.length !== 2) return false;
  return (Object.keys(TRIAD_MIN) as Array<keyof typeof TRIAD_MIN>).every(
    (key) => value[key].trim().length >= TRIAD_MIN[key],
  );
}

export function TriadStep({
  payload,
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  payload: TriadPayload;
  value: TriadValue;
  onChange: (value: TriadValue) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const toggle = (code: string): void => {
    const selected = value.similarPair.includes(code)
      ? value.similarPair.filter((c) => c !== code)
      : [...value.similarPair, code].slice(-2);
    onChange({ ...value, similarPair: selected });
  };

  const third = payload.elements.find((element) => !value.similarPair.includes(element.code));

  return (
    <>
      <Notice tone="info">
        Триада {payload.index} из {payload.total}. Фамилии реальных коллег указывать не требуется —
        достаточно мысленно закрепить за описанием конкретного специалиста.
      </Notice>
      <AntiPrimingNotice />

      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-medium text-graphite-800">
          Какие два специалиста наиболее похожи с точки зрения профессиональной эффективности?
        </legend>
        <div className="space-y-2">
          {payload.elements.map((element) => {
            const selected = value.similarPair.includes(element.code);
            return (
              <button
                key={element.code}
                type="button"
                onClick={() => toggle(element.code)}
                aria-pressed={selected}
                className={`block w-full rounded border px-3 py-2.5 text-left text-sm transition-colors ${
                  selected
                    ? 'border-accent-600 bg-accent-50'
                    : 'border-graphite-300 bg-white hover:bg-graphite-50'
                }`}
              >
                <span className="font-medium text-graphite-900">{element.label}</span>
                {element.description && (
                  <span className="mt-0.5 block text-xs text-graphite-600">{element.description}</span>
                )}
              </button>
            );
          })}
        </div>
        {value.similarPair.length === 2 && third && (
          <p className="mt-2 text-xs text-graphite-600">
            Третий специалист: <span className="font-medium">{third.label}</span>
          </p>
        )}
      </fieldset>

      <AnswerField
        label="Чем именно эти два специалиста похожи с точки зрения профессиональной эффективности"
        value={value.similarity}
        minLength={TRIAD_MIN.similarity}
        onChange={(text) => onChange({ ...value, similarity: text })}
      />
      <AnswerField
        label="Чем третий отличается"
        value={value.difference}
        minLength={TRIAD_MIN.difference}
        onChange={(text) => onChange({ ...value, difference: text })}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-graphite-800">
            Первый полюс критерия
            <span className="ml-1 font-normal text-graphite-400">короткая формулировка</span>
          </label>
          <input
            value={value.poleLeft}
            onChange={(event) => onChange({ ...value, poleLeft: event.target.value })}
            className="w-full rounded border border-graphite-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-graphite-800">
            Противоположный полюс
            <span className="ml-1 font-normal text-graphite-400">короткая формулировка</span>
          </label>
          <input
            value={value.poleRight}
            onChange={(event) => onChange({ ...value, poleRight: event.target.value })}
            className="w-full rounded border border-graphite-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <AnswerField
        label="Почему этот критерий важен"
        value={value.importanceReason}
        minLength={TRIAD_MIN.importanceReason}
        onChange={(text) => onChange({ ...value, importanceReason: text })}
      />
      <AnswerField
        label="Как этот критерий проявляется непосредственно на буровой"
        value={value.rigManifestation}
        minLength={TRIAD_MIN.rigManifestation}
        onChange={(text) => onChange({ ...value, rigManifestation: text })}
      />
      <AnswerField
        label="Приведите пример из собственного опыта"
        hint="Конкретная ситуация: что наблюдали, что сделали, что получилось."
        rows={5}
        value={value.experienceExample}
        minLength={TRIAD_MIN.experienceExample}
        onChange={(text) => onChange({ ...value, experienceExample: text })}
      />

      <StepActions onSubmit={onSubmit} disabled={!triadReady(value)} submitting={submitting} />
    </>
  );
}

// ─── Проверка на дублирование конструктов ────────────────────────────────────

export interface SimilarityPayload {
  question: string;
  note: string;
  constructs: Array<{ id: string; poleLeft: string; poleRight: string }>;
}

export function SimilarityStep({
  payload,
  onSubmit,
  submitting,
}: {
  payload: SimilarityPayload;
  onSubmit: (verdict: 'SAME' | 'DIFFERENT', explanation: string) => void;
  submitting: boolean;
}) {
  const [verdict, setVerdict] = useState<'SAME' | 'DIFFERENT' | null>(null);
  const [explanation, setExplanation] = useState('');

  return (
    <>
      <Notice tone="method">{payload.note}</Notice>
      <div className="mb-5 space-y-2">
        {payload.constructs.map((construct, index) => (
          <div key={construct.id} className="rounded border border-graphite-300 bg-white px-3 py-2.5 text-sm">
            <span className="mr-2 text-xs text-graphite-500">Критерий {index + 1}</span>
            <span className="font-medium">{construct.poleLeft}</span>
            <span className="mx-2 text-graphite-400">↔</span>
            <span className="font-medium">{construct.poleRight}</span>
          </div>
        ))}
      </div>

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium text-graphite-800">{payload.question}</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant={verdict === 'SAME' ? 'primary' : 'secondary'}
            onClick={() => setVerdict('SAME')}
          >
            Означают одно и то же
          </Button>
          <Button
            variant={verdict === 'DIFFERENT' ? 'primary' : 'secondary'}
            onClick={() => setVerdict('DIFFERENT')}
          >
            Это разные критерии
          </Button>
        </div>
      </fieldset>

      {verdict === 'DIFFERENT' && (
        <AnswerField
          label="В чём именно состоит различие"
          value={explanation}
          minLength={20}
          onChange={setExplanation}
        />
      )}

      <StepActions
        onSubmit={() => verdict && onSubmit(verdict, explanation)}
        disabled={!verdict || (verdict === 'DIFFERENT' && explanation.trim().length < 20)}
        submitting={submitting}
      />
    </>
  );
}

// ─── Репертуарная решётка ────────────────────────────────────────────────────

export interface GridPayload {
  constructs: Array<{ id: string; poleLeft: string; poleRight: string }>;
  elements: Array<{ id: string; code: string; label: string }>;
  ratings: Array<{ constructId: string; elementId: string; rating: number }>;
  scaleLabels: string[];
}

export function GridStep({
  payload,
  onRate,
  onComplete,
  submitting,
}: {
  payload: GridPayload;
  onRate: (constructId: string, elementId: string, rating: number) => void;
  onComplete: () => void;
  submitting: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [local, setLocal] = useState<Map<string, number>>(
    () => new Map(payload.ratings.map((r) => [`${r.constructId}:${r.elementId}`, r.rating])),
  );

  const construct = payload.constructs[index];
  const total = payload.constructs.length * payload.elements.length;
  const filled = local.size;

  useEffect(() => {
    setLocal(new Map(payload.ratings.map((r) => [`${r.constructId}:${r.elementId}`, r.rating])));
  }, [payload.ratings]);

  if (!construct) {
    return <Notice tone="info">Сначала сформулируйте критерии оценки.</Notice>;
  }

  const rate = (elementId: string, rating: number): void => {
    setLocal((previous) => new Map(previous).set(`${construct.id}:${elementId}`, rating));
    onRate(construct.id, elementId, rating);
  };

  const constructComplete = payload.elements.every((element) =>
    local.has(`${construct.id}:${element.id}`),
  );
  const allComplete = filled >= total;

  return (
    <>
      <Notice tone="info">
        Критерий {index + 1} из {payload.constructs.length}. Заполнено клеток: {filled} из {total}.
        Оценивается профессиональное поведение специалиста, а не его личные качества.
      </Notice>

      {/* Оба полюса критерия видны постоянно (требование §6). */}
      <div className="mb-4 rounded border border-accent-200 bg-accent-50 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold text-graphite-900">1 — {construct.poleLeft}</span>
          <span className="font-semibold text-graphite-900">{construct.poleRight} — 7</span>
        </div>
      </div>

      <div className="space-y-3">
        {payload.elements.map((element) => {
          const current = local.get(`${construct.id}:${element.id}`);
          return (
            <div key={element.id} className="rounded border border-graphite-200 bg-white px-3 py-2.5">
              <div className="mb-2 text-sm text-graphite-800">
                <span className="mr-2 font-mono text-xs text-graphite-500">{element.code}</span>
                {element.label}
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Оценка: ${element.label}`}>
                {[1, 2, 3, 4, 5, 6, 7].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => rate(element.id, rating)}
                    aria-pressed={current === rating}
                    title={payload.scaleLabels[rating - 1]}
                    className={`h-9 w-9 rounded border text-sm tnum ${
                      current === rating
                        ? 'border-accent-700 bg-accent-700 text-white'
                        : 'border-graphite-300 bg-white text-graphite-700 hover:bg-graphite-50'
                    }`}
                  >
                    {rating}
                  </button>
                ))}
              </div>
              {current && (
                <p className="mt-1 text-2xs text-graphite-500">{payload.scaleLabels[current - 1]}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            Предыдущий критерий
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIndex((i) => Math.min(payload.constructs.length - 1, i + 1))}
            disabled={index >= payload.constructs.length - 1 || !constructComplete}
          >
            Следующий критерий
          </Button>
        </div>
        <Button size="lg" onClick={onComplete} disabled={!allComplete || submitting}>
          {submitting ? 'Отправка…' : 'Завершить заполнение'}
        </Button>
      </div>
    </>
  );
}

// ─── Лестница смыслов ────────────────────────────────────────────────────────

export interface LadderPayload {
  construct: { id: string; poleLeft: string; poleRight: string };
  previousSteps: Array<{ depth: number; question: string; answer: string }>;
  depth: number;
  question: string;
}

export function LadderStep({
  payload,
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  payload: LadderPayload;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <>
      <div className="mb-4 rounded border border-graphite-300 bg-white px-3 py-2.5 text-sm">
        <span className="font-medium">{payload.construct.poleLeft}</span>
        <span className="mx-2 text-graphite-400">↔</span>
        <span className="font-medium">{payload.construct.poleRight}</span>
      </div>

      {payload.previousSteps.length > 0 && (
        <ol className="mb-4 space-y-2 border-l-2 border-graphite-200 pl-3">
          {payload.previousSteps.map((step) => (
            <li key={step.depth} className="text-sm">
              <div className="text-xs text-graphite-500">{step.question}</div>
              <div className="text-graphite-800">{step.answer}</div>
            </li>
          ))}
        </ol>
      )}

      <AnswerField
        label={payload.question}
        hint={`Уточняющий вопрос ${payload.depth} из максимум 5.`}
        value={value}
        minLength={20}
        rows={4}
        onChange={onChange}
      />

      <StepActions onSubmit={onSubmit} disabled={value.trim().length < 20} submitting={submitting} />
    </>
  );
}

// ─── Ситуационный кейс ───────────────────────────────────────────────────────

export interface SubFieldDef {
  key: string;
  label: string;
  required: boolean;
  minLength?: number;
}

export interface CasePayload {
  scenario: { code: string; title: string; difficulty: number };
  stage: {
    stageIndex: number;
    situation: string;
    dynamics: Array<{ label: string; unit: string; points: Array<{ t: string; value: number }> }> | null;
    constraints: string | null;
    adjacentServiceInfo: string | null;
    revealNote: string | null;
  };
  questions: Array<{
    id: string;
    prompt: string;
    helpText: string | null;
    subFields: SubFieldDef[] | null;
    minLength: number | null;
  }>;
  drafts: Array<{ questionVersionId: string; valueJson: unknown; status: string }>;
  previousStages: Array<{ valueJson: unknown; questionVersion: { scenarioStage: { stageIndex: number } | null } }>;
}

export function caseReady(fields: Record<string, string>, definitions: SubFieldDef[]): boolean {
  return definitions.every((definition) => {
    const text = (fields[definition.key] ?? '').trim();
    if (definition.required && text.length === 0) return false;
    if (definition.minLength && text.length < definition.minLength) return false;
    return true;
  });
}

export function CaseStep({
  payload,
  fields,
  onChange,
  onSubmit,
  submitting,
}: {
  payload: CasePayload;
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const question = payload.questions[0];
  const definitions = useMemo(() => question?.subFields ?? [], [question]);

  const previous = payload.previousStages
    .map((item) => item.valueJson as { fields?: Record<string, string> } | null)
    .filter((value): value is { fields: Record<string, string> } => Boolean(value?.fields));

  if (!question) return <Notice tone="tech">Вопрос этапа не найден.</Notice>;

  return (
    <>
      <Card
        title={payload.scenario.title}
        subtitle={`Этап ${payload.stage.stageIndex + 1}`}
        className="mb-4"
      >
        <p className="whitespace-pre-line text-sm leading-relaxed text-graphite-800">
          {payload.stage.situation}
        </p>

        {payload.stage.dynamics && payload.stage.dynamics.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-graphite-600">
              Динамика параметров
            </h3>
            <LineChart series={payload.stage.dynamics} />
            <Table
              headers={[
                { label: 'Параметр' },
                { label: 'Единица' },
                { label: 'Значения', align: 'left' },
              ]}
              caption="Табличное представление динамики параметров"
            >
              {payload.stage.dynamics.map((series) => (
                <tr key={series.label}>
                  <Td>{series.label}</Td>
                  <Td>{series.unit}</Td>
                  <Td numeric>{series.points.map((p) => `${p.t}: ${p.value}`).join('; ')}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {payload.stage.constraints && (
          <div className="mt-3 border-l-2 border-l-graphite-400 bg-graphite-50 px-3 py-2 text-xs text-graphite-700">
            <span className="font-semibold">Ограничения. </span>
            {payload.stage.constraints}
          </div>
        )}
        {payload.stage.adjacentServiceInfo && (
          <div className="mt-2 border-l-2 border-l-accent-400 bg-accent-50 px-3 py-2 text-xs text-graphite-800">
            <span className="font-semibold">Информация от смежных сервисов. </span>
            {payload.stage.adjacentServiceInfo}
          </div>
        )}
      </Card>

      {payload.stage.stageIndex > 0 && previous.length > 0 && (
        <Card title="Ваше решение на предыдущем этапе" className="mb-4">
          <dl className="space-y-1.5 text-xs">
            {Object.entries(previous[0]!.fields).map(([key, text]) => (
              <div key={key}>
                <dt className="text-graphite-500">{key}</dt>
                <dd className="text-graphite-800">{text}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <p className="mb-3 text-sm text-graphite-800">{question.prompt}</p>
      {question.helpText && <Notice tone="method">{question.helpText}</Notice>}

      {definitions.map((definition) => (
        <AnswerField
          key={definition.key}
          label={definition.label}
          value={fields[definition.key] ?? ''}
          minLength={definition.minLength}
          rows={definition.minLength && definition.minLength >= 60 ? 4 : 3}
          onChange={(text) => onChange({ ...fields, [definition.key]: text })}
        />
      ))}

      <StepActions
        onSubmit={onSubmit}
        disabled={!caseReady(fields, definitions)}
        submitting={submitting}
        label={payload.stage.revealNote ? 'Зафиксировать решение' : 'Далее'}
      />
    </>
  );
}

// ─── Открытый вопрос и самооценка ────────────────────────────────────────────

export interface QuestionPayload {
  question: {
    id: string;
    prompt: string;
    helpText: string | null;
    minLength: number | null;
    maxLength: number | null;
    options: unknown;
    subFields: SubFieldDef[] | null;
    question: { type: string };
  };
  draft: { valueJson: unknown; status: string } | null;
}

export function TextQuestionStep({
  payload,
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  payload: QuestionPayload;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const minLength = payload.question.minLength ?? 0;
  return (
    <>
      <p className="mb-3 whitespace-pre-line text-sm leading-relaxed text-graphite-800">
        {payload.question.prompt}
      </p>
      {payload.question.helpText && <Notice tone="method">{payload.question.helpText}</Notice>}
      <AnswerField
        label="Ваш ответ"
        value={value}
        minLength={minLength || undefined}
        rows={10}
        onChange={onChange}
      />
      <StepActions
        onSubmit={onSubmit}
        disabled={value.trim().length < minLength}
        submitting={submitting}
      />
    </>
  );
}

export interface SelfRatingItem {
  code: string;
  label: string;
}

export function SelfRatingStep({
  payload,
  values,
  onChange,
  onSubmit,
  submitting,
}: {
  payload: QuestionPayload;
  values: Record<string, { level: number | null; justification: string }>;
  onChange: (values: Record<string, { level: number | null; justification: string }>) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const options = payload.question.options as {
    scale?: { min: number; max: number; labels: string[] };
    items?: SelfRatingItem[];
  } | null;
  const items = options?.items ?? [];
  const labels = options?.scale?.labels ?? ['0', '1', '2', '3', '4'];

  const ready = items.every((item) => {
    const entry = values[item.code];
    return entry && entry.level !== null && entry.justification.trim().length >= 40;
  });

  return (
    <>
      <p className="mb-3 text-sm leading-relaxed text-graphite-800">{payload.question.prompt}</p>
      {payload.question.helpText && <Notice tone="method">{payload.question.helpText}</Notice>}

      <div className="space-y-4">
        {items.map((item) => {
          const entry = values[item.code] ?? { level: null, justification: '' };
          return (
            <div key={item.code} className="rounded border border-graphite-200 bg-white px-3 py-3">
              <div className="mb-2 text-sm font-medium text-graphite-900">{item.label}</div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {labels.map((label, level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onChange({ ...values, [item.code]: { ...entry, level } })}
                    aria-pressed={entry.level === level}
                    className={`rounded border px-2.5 py-1 text-xs ${
                      entry.level === level
                        ? 'border-accent-700 bg-accent-700 text-white'
                        : 'border-graphite-300 bg-white text-graphite-700'
                    }`}
                  >
                    {level} — {label}
                  </button>
                ))}
              </div>
              <AnswerField
                label="Обоснование примером из практики"
                value={entry.justification}
                minLength={40}
                rows={3}
                onChange={(text) => onChange({ ...values, [item.code]: { ...entry, justification: text } })}
              />
            </div>
          );
        })}
      </div>

      <StepActions onSubmit={onSubmit} disabled={!ready} submitting={submitting} />
    </>
  );
}

// ─── Финальная страница ──────────────────────────────────────────────────────

export function FinishStep({ message, note }: { message: string; note: string }) {
  return (
    <div className="rounded border border-graphite-200 bg-white px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-graphite-900">{message}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-graphite-600">{note}</p>
    </div>
  );
}
