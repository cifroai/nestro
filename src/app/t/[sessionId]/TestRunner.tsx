'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, api } from '../../../lib/api.js';
import { Button, Notice, Spinner, TechError } from '../../../components/ui/index.js';
import { StepShell, useTelemetry, type SaveState } from '../../../components/candidate/StepShell.js';
import {
  CaseStep,
  EMPTY_TRIAD,
  FinishStep,
  GridStep,
  LadderStep,
  SelfRatingStep,
  SimilarityStep,
  TextQuestionStep,
  TriadStep,
  type CasePayload,
  type GridPayload,
  type LadderPayload,
  type QuestionPayload,
  type SimilarityPayload,
  type TriadPayload,
  type TriadValue,
} from '../../../components/candidate/steps.js';

/**
 * Движок прохождения на стороне кандидата.
 *
 * Свойства (§53, §25):
 *  — порядок шагов определяет сервер: клиент лишь отображает текущий шаг;
 *  — черновик отправляется автоматически, окончательная отправка — по кнопке;
 *  — после разрыва соединения состояние восстанавливается с сервера.
 */

type Step =
  | { kind: 'KELLY_TRIAD'; triadId: string; questionVersionId: string; index: number; total: number }
  | { kind: 'CONSTRUCT_SIMILARITY_CHECK'; checkId: string }
  | { kind: 'REPERTORY_GRID'; questionVersionId: string }
  | { kind: 'LADDERING'; constructId: string; depth: number }
  | { kind: 'CASE_STAGE'; scenarioId: string; stageId: string; stageIndex: number; questionVersionIds: string[] }
  | { kind: 'QUESTION'; section: 'ARGUMENTATION' | 'SELF_RATING'; questionVersionId: string }
  | { kind: 'FINISH' };

interface SessionState {
  sessionId: string;
  status: string;
  progressPercent: number;
  currentSection: string;
  positionTitle: string;
  assessmentTitle: string;
  deadline: string | null;
  sections: Array<{ section: string; completed: number; total: number }>;
  step: Step;
  stepPayload: unknown;
}

const AUTOSAVE_DELAY_MS = 2500;

export function TestRunner({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Значения текущего шага.
  const [triad, setTriad] = useState<TriadValue>(EMPTY_TRIAD);
  const [caseFields, setCaseFields] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [ladderAnswer, setLadderAnswer] = useState('');
  const [selfRating, setSelfRating] = useState<Record<string, { level: number | null; justification: string }>>({});

  const stepKey = useMemo(() => JSON.stringify(state?.step ?? {}), [state?.step]);
  const { telemetry, markInput } = useTelemetry(stepKey);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.get<SessionState>(`/api/sessions/${sessionId}`);
      setState(next);
      setLoadError(null);
      if (next.status === 'COMPLETED') setCompleted(true);
    } catch (error) {
      setLoadError(
        error instanceof ApiRequestError
          ? error.message
          : 'Не удалось загрузить состояние сессии. Проверьте соединение.',
      );
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Сброс локальных значений при смене шага; черновики подставляются с сервера.
  useEffect(() => {
    if (!state) return;
    setSaveState('idle');
    setSaveError(null);

    if (state.step.kind === 'CASE_STAGE') {
      const payload = state.stepPayload as CasePayload;
      const draft = payload.drafts[0]?.valueJson as { fields?: Record<string, string> } | undefined;
      setCaseFields(draft?.fields ?? {});
    }
    if (state.step.kind === 'QUESTION') {
      const payload = state.stepPayload as QuestionPayload;
      const draft = payload.draft?.valueJson as
        | { text?: string; ratings?: Array<{ competencyCode: string; level: number; justification: string }> }
        | undefined;
      if (payload.question.question.type === 'SELF_RATING') {
        const entries: Record<string, { level: number | null; justification: string }> = {};
        for (const item of draft?.ratings ?? []) {
          entries[item.competencyCode] = { level: item.level, justification: item.justification };
        }
        setSelfRating(entries);
      } else {
        setText(draft?.text ?? '');
      }
    }
    if (state.step.kind === 'KELLY_TRIAD') setTriad(EMPTY_TRIAD);
    if (state.step.kind === 'LADDERING') setLadderAnswer('');
  }, [state]);

  const reportEvent = useCallback(
    async (type: 'TAB_HIDDEN' | 'TAB_VISIBLE' | 'RECONNECT') => {
      try {
        await api.post(`/api/sessions/${sessionId}/events`, { type });
      } catch {
        // Технический журнал не должен мешать прохождению.
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const onVisibility = (): void => {
      void reportEvent(document.visibilityState === 'hidden' ? 'TAB_HIDDEN' : 'TAB_VISIBLE');
    };
    const onOnline = (): void => {
      void reportEvent('RECONNECT');
      void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [reportEvent, load]);

  const save = useCallback(
    async (
      value: unknown,
      status: 'DRAFT' | 'SUBMITTED',
      questionVersionId?: string,
      stageIndex?: number,
    ): Promise<{ nextStep: Step | null; followUp: unknown } | null> => {
      setSaveState('saving');
      setSaveError(null);
      try {
        const result = await api.post<{ nextStep: Step | null; followUp: unknown; progressPercent: number }>(
          '/api/answers',
          {
            sessionId,
            ...(questionVersionId ? { questionVersionId } : {}),
            ...(stageIndex !== undefined ? { stageIndex } : {}),
            value,
            status,
            telemetry: telemetry(),
          },
        );
        setSaveState('saved');
        return result;
      } catch (error) {
        setSaveState('error');
        setSaveError(error instanceof ApiRequestError ? error.message : 'Ошибка сети');
        return null;
      }
    },
    [sessionId, telemetry],
  );

  /** Автосохранение черновика с задержкой: не создаёт лишних ревизий. */
  const scheduleAutosave = useCallback(
    (value: unknown, questionVersionId?: string, stageIndex?: number) => {
      markInput();
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void save(value, 'DRAFT', questionVersionId, stageIndex);
      }, AUTOSAVE_DELAY_MS);
    },
    [markInput, save],
  );

  const submit = useCallback(
    async (value: unknown, questionVersionId?: string, stageIndex?: number) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      setSubmitting(true);
      const result = await save(value, 'SUBMITTED', questionVersionId, stageIndex);
      setSubmitting(false);
      if (result) await load();
    },
    [save, load],
  );

  const finish = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/sessions/${sessionId}/complete`);
      setCompleted(true);
      await load();
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof ApiRequestError ? error.message : 'Ошибка сети');
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, load]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <TechError>{loadError}</TechError>
        <Button onClick={() => void load()}>Повторить загрузку</Button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Spinner label="Загрузка состояния тестирования" />
      </div>
    );
  }

  const shellProps = {
    section: state.currentSection,
    progressPercent: state.progressPercent,
    sections: state.sections,
    saveState,
    saveError,
  };

  // Сессия завершена: показывается только подтверждение (§75).
  if (completed || state.status === 'COMPLETED') {
    const payload = state.stepPayload as { message?: string; note?: string };
    return (
      <StepShell {...shellProps} section="FINISH" title="Тестирование завершено">
        <FinishStep
          message={payload.message ?? 'Тестирование завершено. Ответы сохранены.'}
          note={
            payload.note ??
            'Результаты передаются техническому эксперту и специалисту по подбору. Дополнительных действий от вас не требуется.'
          }
        />
      </StepShell>
    );
  }

  // Все разделы пройдены, но подтверждение отправки ещё не выполнено.
  if (state.step.kind === 'FINISH') {
    return (
      <StepShell {...shellProps} section="FINISH" title="Все разделы пройдены">
        <Notice tone="info">
          Ответы сохранены на сервере. Нажмите «Завершить тестирование», чтобы передать их на оценку.
          После завершения изменение ответов будет недоступно.
        </Notice>
        <div className="mt-4">
          <Button size="lg" onClick={() => void finish()} disabled={submitting}>
            {submitting ? 'Отправка…' : 'Завершить тестирование'}
          </Button>
        </div>
      </StepShell>
    );
  }

  switch (state.step.kind) {
    case 'KELLY_TRIAD': {
      const payload = state.stepPayload as TriadPayload;
      const step = state.step;
      return (
        <StepShell {...shellProps} title="Профессиональные критерии оценки">
          <TriadStep
            payload={payload}
            value={triad}
            submitting={submitting}
            onChange={(next) => {
              setTriad(next);
              scheduleAutosave(
                { kind: 'KELLY_TRIAD', triadId: step.triadId, ...next },
                step.questionVersionId,
              );
            }}
            onSubmit={() =>
              void submit({ kind: 'KELLY_TRIAD', triadId: step.triadId, ...triad }, step.questionVersionId)
            }
          />
        </StepShell>
      );
    }

    case 'CONSTRUCT_SIMILARITY_CHECK': {
      const payload = state.stepPayload as SimilarityPayload;
      const step = state.step;
      return (
        <StepShell {...shellProps} title="Уточнение критериев">
          <SimilarityStep
            payload={payload}
            submitting={submitting}
            onSubmit={(verdict, explanation) =>
              void submit({
                kind: 'CONSTRUCT_SIMILARITY_VERDICT',
                checkId: step.checkId,
                verdict,
                ...(explanation ? { explanation } : {}),
              })
            }
          />
        </StepShell>
      );
    }

    case 'REPERTORY_GRID': {
      const payload = state.stepPayload as GridPayload;
      return (
        <StepShell {...shellProps} title="Оценка специалистов по вашим критериям">
          <GridStep
            payload={payload}
            submitting={submitting}
            onRate={(constructId, elementId, rating) => {
              void save({ kind: 'GRID_RATING', constructId, elementId, rating }, 'DRAFT');
            }}
            onComplete={() => void submit({ kind: 'GRID_COMPLETE' })}
          />
        </StepShell>
      );
    }

    case 'LADDERING': {
      const payload = state.stepPayload as LadderPayload;
      const step = state.step;
      return (
        <StepShell {...shellProps} title="Уточнение значимости критерия">
          <LadderStep
            payload={payload}
            value={ladderAnswer}
            submitting={submitting}
            onChange={(next) => {
              setLadderAnswer(next);
              markInput();
            }}
            onSubmit={() =>
              void submit({
                kind: 'LADDER_STEP',
                constructId: step.constructId,
                depth: step.depth,
                answer: ladderAnswer,
              })
            }
          />
        </StepShell>
      );
    }

    case 'CASE_STAGE': {
      const payload = state.stepPayload as CasePayload;
      const step = state.step;
      const questionVersionId = payload.questions[0]?.id ?? step.questionVersionIds[0];
      return (
        <StepShell {...shellProps} title="Профессиональный ситуационный кейс">
          <CaseStep
            payload={payload}
            fields={caseFields}
            submitting={submitting}
            onChange={(fields) => {
              setCaseFields(fields);
              scheduleAutosave({ kind: 'CASE', fields }, questionVersionId, step.stageIndex);
            }}
            onSubmit={() =>
              void submit({ kind: 'CASE', fields: caseFields }, questionVersionId, step.stageIndex)
            }
          />
        </StepShell>
      );
    }

    case 'QUESTION': {
      const payload = state.stepPayload as QuestionPayload;
      const step = state.step;
      const isSelfRating = payload.question.question.type === 'SELF_RATING';
      return (
        <StepShell
          {...shellProps}
          title={isSelfRating ? 'Самооценка' : 'Профессиональная аргументация'}
        >
          {isSelfRating ? (
            <SelfRatingStep
              payload={payload}
              values={selfRating}
              submitting={submitting}
              onChange={(values) => {
                setSelfRating(values);
                scheduleAutosave(
                  {
                    kind: 'SELF_RATING',
                    ratings: Object.entries(values)
                      .filter(([, entry]) => entry.level !== null)
                      .map(([competencyCode, entry]) => ({
                        competencyCode,
                        level: entry.level as number,
                        justification: entry.justification,
                      })),
                  },
                  step.questionVersionId,
                );
              }}
              onSubmit={() =>
                void submit(
                  {
                    kind: 'SELF_RATING',
                    ratings: Object.entries(selfRating)
                      .filter(([, entry]) => entry.level !== null)
                      .map(([competencyCode, entry]) => ({
                        competencyCode,
                        level: entry.level as number,
                        justification: entry.justification,
                      })),
                  },
                  step.questionVersionId,
                )
              }
            />
          ) : (
            <TextQuestionStep
              payload={payload}
              value={text}
              submitting={submitting}
              onChange={(next) => {
                setText(next);
                scheduleAutosave({ kind: 'TEXT', text: next }, step.questionVersionId);
              }}
              onSubmit={() => void submit({ kind: 'TEXT', text }, step.questionVersionId)}
            />
          )}
        </StepShell>
      );
    }

    default:
      return (
        <StepShell {...shellProps} title="Тестирование">
          <Spinner label="Определение следующего шага" />
        </StepShell>
      );
  }
}
