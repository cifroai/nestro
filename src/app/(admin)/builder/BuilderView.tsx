'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../../lib/api.js';
import {
  Button,
  Card,
  EmptyState,
  Notice,
  Select,
  Spinner,
  Table,
  Tag,
  Td,
  TextInput,
} from '../../../components/ui/index.js';
import { formatNumber } from '../../../lib/format.js';

/**
 * Конструктор ассессментов (§33).
 * Правка допустима только в черновой версии: опубликованная версия
 * неизменяема, изменения вносятся в клон.
 */

interface AssessmentItem {
  id: string;
  code: string;
  title: string;
  position: { code: string; title: string };
  versions: Array<{ id: string; version: number; status: string; publishedAt: string | null }>;
}

interface VersionDetail {
  id: string;
  version: number;
  status: string;
  disagreementThreshold: string;
  gateThreshold: string;
  minCoverage: string;
  bandThresholds: { EXPERT: number; HIGH: number; SUFFICIENT: number; GAPS: number };
  ladderConstructCount: number;
  targetConstructCount: number;
  similarityThreshold: string;
  assessment: { title: string; position: { title: string } };
  competencies: Array<{
    id: string;
    competencyId: string;
    weight: string;
    isHardGate: boolean;
    minEvidenceCount: number;
    minQuestionCount: number;
    competency: { code: string; title: string; axis: string };
  }>;
  kellyTriads: Array<{ code: string; isReserve: boolean }>;
  scenarios: Array<{ code: string; title: string; difficulty: number; stages: Array<{ stageIndex: number }> }>;
  questionVersions: Array<{ id: string; section: string; isActive: boolean; question: { code: string; type: string } }>;
  scoringModel: { code: string; version: number } | null;
}

interface WeightDraft {
  competencyId: string;
  code: string;
  title: string;
  weight: number;
  isHardGate: boolean;
  minEvidenceCount: number;
  minQuestionCount: number;
}

export function BuilderView() {
  const [assessments, setAssessments] = useState<AssessmentItem[] | null>(null);
  const [versionId, setVersionId] = useState<string>('');
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [weights, setWeights] = useState<WeightDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ items: AssessmentItem[] }>('/api/assessments');
      setAssessments(result.items);
      const firstVersion = result.items[0]?.versions[0]?.id;
      if (firstVersion) setVersionId(firstVersion);
    })();
  }, []);

  const loadDetail = useCallback(async () => {
    if (!versionId) return;
    setError(null);
    const result = await api.get<VersionDetail>(`/api/assessment-versions/${versionId}`);
    setDetail(result);
    setWeights(
      result.competencies.map((item) => ({
        competencyId: item.competencyId,
        code: item.competency.code,
        title: item.competency.title,
        weight: Number(item.weight),
        isHardGate: item.isHardGate,
        minEvidenceCount: item.minEvidenceCount,
        minQuestionCount: item.minQuestionCount,
      })),
    );
  }, [versionId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!assessments) return <Spinner label="Загрузка конструктора" />;

  const weightSum = weights.reduce((accumulator, item) => accumulator + item.weight, 0);
  const editable = detail?.status === 'DRAFT';

  const action = async (fn: () => Promise<unknown>, successText: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(successText);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Операция не выполнена');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Ассессменты и версии">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-96">
            <label className="mb-1 block text-2xs uppercase text-graphite-500">Версия</label>
            <Select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
              {assessments.flatMap((assessment) =>
                assessment.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {assessment.position.title} — {assessment.title}, в. {version.version} ({version.status})
                  </option>
                )),
              )}
            </Select>
          </div>
          {detail && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void action(
                    () => api.post<{ versionId: string }>(`/api/assessment-versions/${detail.id}/clone`),
                    'Создан новый черновик на основе выбранной версии.',
                  )
                }
              >
                Клонировать в черновик
              </Button>
              {editable && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api.post(`/api/assessment-versions/${detail.id}/publish`),
                      'Версия опубликована и теперь неизменяема.',
                    )
                  }
                >
                  Опубликовать версию
                </Button>
              )}
            </div>
          )}
        </div>
        {message && <Notice tone="method">{message}</Notice>}
        {error && <Notice tone="tech">{error}</Notice>}
      </Card>

      {!detail ? (
        <Spinner />
      ) : (
        <>
          {!editable && (
            <Notice tone="method" title="Версия опубликована">
              Опубликованная версия неизменяема: это гарантирует воспроизводимость результатов
              кандидатов, проходивших тест на этой версии. Для изменений создайте клон.
            </Notice>
          )}

          <Card
            title="Веса компетенций"
            subtitle={`Сумма весов: ${formatNumber(weightSum, 2)} (требуется 100)`}
            actions={
              editable && (
                <Button
                  size="sm"
                  disabled={busy || Math.abs(weightSum - 100) > 0.01}
                  onClick={() =>
                    void action(
                      () =>
                        api.patch(`/api/assessment-versions/${detail.id}/weights`, {
                          weights: weights.map((item) => ({
                            competencyId: item.competencyId,
                            weight: item.weight,
                            isHardGate: item.isHardGate,
                            minEvidenceCount: item.minEvidenceCount,
                            minQuestionCount: item.minQuestionCount,
                          })),
                        }),
                      'Веса сохранены; изменение зафиксировано в журнале аудита.',
                    )
                  }
                >
                  Сохранить веса
                </Button>
              )
            }
          >
            <Table
              headers={[
                { label: 'Компетенция' },
                { label: 'Ось' },
                { label: 'Вес, %', align: 'right' },
                { label: 'Критическая' },
                { label: 'Мин. доказательств', align: 'right' },
                { label: 'Мин. вопросов', align: 'right' },
              ]}
            >
              {weights.map((item, index) => (
                <tr key={item.competencyId}>
                  <Td>{item.title}</Td>
                  <Td className="text-2xs text-graphite-500">
                    {detail.competencies.find((c) => c.competencyId === item.competencyId)?.competency.axis}
                  </Td>
                  <Td numeric align="right">
                    <TextInput
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      disabled={!editable}
                      value={item.weight}
                      onChange={(event) => {
                        const next = [...weights];
                        next[index] = { ...item, weight: Number(event.target.value) };
                        setWeights(next);
                      }}
                      className="w-20 text-right"
                    />
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={item.isHardGate}
                      onChange={(event) => {
                        const next = [...weights];
                        next[index] = { ...item, isHardGate: event.target.checked };
                        setWeights(next);
                      }}
                      className="h-3.5 w-3.5"
                    />
                  </Td>
                  <Td numeric align="right">
                    <TextInput
                      type="number"
                      min={1}
                      max={50}
                      disabled={!editable}
                      value={item.minEvidenceCount}
                      onChange={(event) => {
                        const next = [...weights];
                        next[index] = { ...item, minEvidenceCount: Number(event.target.value) };
                        setWeights(next);
                      }}
                      className="w-16 text-right"
                    />
                  </Td>
                  <Td numeric align="right">
                    <TextInput
                      type="number"
                      min={1}
                      max={50}
                      disabled={!editable}
                      value={item.minQuestionCount}
                      onChange={(event) => {
                        const next = [...weights];
                        next[index] = { ...item, minQuestionCount: Number(event.target.value) };
                        setWeights(next);
                      }}
                      className="w-16 text-right"
                    />
                  </Td>
                </tr>
              ))}
            </Table>
            <Notice tone="method">
              Критическая компетенция (hard-gate) не отклоняет кандидата автоматически: при уровне ниже
              порога в отчёте появляется отметка «Критическая компетенция требует дополнительной проверки».
            </Notice>
          </Card>

          <ThresholdEditor
            detail={detail}
            editable={Boolean(editable)}
            busy={busy}
            onSave={(payload) =>
              action(
                () => api.patch(`/api/assessment-versions/${detail.id}/thresholds`, payload),
                'Пороги сохранены; изменение зафиксировано в журнале аудита.',
              )
            }
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={`Ситуационные кейсы: ${detail.scenarios.length}`}>
              {detail.scenarios.length === 0 ? (
                <EmptyState title="Кейсы не заданы" />
              ) : (
                <Table
                  headers={[
                    { label: 'Код' },
                    { label: 'Название' },
                    { label: 'Сложность', align: 'right' },
                    { label: 'Этапов', align: 'right' },
                  ]}
                >
                  {detail.scenarios.map((scenario) => (
                    <tr key={scenario.code}>
                      <Td className="font-mono text-2xs">{scenario.code}</Td>
                      <Td>{scenario.title}</Td>
                      <Td numeric align="right">{scenario.difficulty}</Td>
                      <Td numeric align="right">{scenario.stages.length}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card title="Состав версии">
              <Table headers={[{ label: 'Элемент' }, { label: 'Количество', align: 'right' }]}>
                <tr>
                  <Td>Триад Келли (в т. ч. резервных)</Td>
                  <Td numeric align="right">
                    {detail.kellyTriads.length} ({detail.kellyTriads.filter((t) => t.isReserve).length})
                  </Td>
                </tr>
                <tr>
                  <Td>Вопросов, активных</Td>
                  <Td numeric align="right">
                    {detail.questionVersions.filter((q) => q.isActive).length} из {detail.questionVersions.length}
                  </Td>
                </tr>
                <tr>
                  <Td>Модель скоринга</Td>
                  <Td numeric align="right">
                    {detail.scoringModel ? `${detail.scoringModel.code} v${detail.scoringModel.version}` : '—'}
                  </Td>
                </tr>
                <tr>
                  <Td>Статус версии</Td>
                  <Td align="right">
                    <Tag tone={detail.status === 'PUBLISHED' ? 'accent' : 'neutral'}>{detail.status}</Tag>
                  </Td>
                </tr>
              </Table>
              <div className="mt-2 space-y-1 text-2xs text-graphite-500">
                {Object.entries(
                  detail.questionVersions.reduce<Record<string, number>>((accumulator, question) => {
                    accumulator[question.section] = (accumulator[question.section] ?? 0) + 1;
                    return accumulator;
                  }, {}),
                ).map(([section, count]) => (
                  <div key={section}>
                    {section}: {count}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ThresholdEditor({
  detail,
  editable,
  busy,
  onSave,
}: {
  detail: VersionDetail;
  editable: boolean;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [bands, setBands] = useState(detail.bandThresholds);
  const [disagreement, setDisagreement] = useState(Number(detail.disagreementThreshold));
  const [gate, setGate] = useState(Number(detail.gateThreshold));
  const [coverage, setCoverage] = useState(Number(detail.minCoverage));
  const [similarity, setSimilarity] = useState(Number(detail.similarityThreshold));
  const [ladder, setLadder] = useState(detail.ladderConstructCount);
  const [target, setTarget] = useState(detail.targetConstructCount);

  useEffect(() => {
    setBands(detail.bandThresholds);
    setDisagreement(Number(detail.disagreementThreshold));
    setGate(Number(detail.gateThreshold));
    setCoverage(Number(detail.minCoverage));
    setSimilarity(Number(detail.similarityThreshold));
    setLadder(detail.ladderConstructCount);
    setTarget(detail.targetConstructCount);
  }, [detail]);

  const numberField = (
    label: string,
    value: number,
    setter: (value: number) => void,
    options: { min: number; max: number; step: number },
  ) => (
    <div key={label}>
      <label className="mb-1 block text-2xs uppercase text-graphite-500">{label}</label>
      <TextInput
        type="number"
        disabled={!editable}
        value={value}
        min={options.min}
        max={options.max}
        step={options.step}
        onChange={(event) => setter(Number(event.target.value))}
      />
    </div>
  );

  return (
    <Card
      title="Пороги и параметры оценки"
      actions={
        editable && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void onSave({
                bandThresholds: bands,
                disagreementThreshold: disagreement,
                gateThreshold: gate,
                minCoverage: coverage,
                similarityThreshold: similarity,
                ladderConstructCount: ladder,
                targetConstructCount: target,
              })
            }
          >
            Сохранить пороги
          </Button>
        )
      }
    >
      <div className="grid gap-3 lg:grid-cols-4">
        {numberField('Экспертный уровень, от', bands.EXPERT, (value) => setBands({ ...bands, EXPERT: value }), {
          min: 0,
          max: 100,
          step: 1,
        })}
        {numberField('Высокий уровень, от', bands.HIGH, (value) => setBands({ ...bands, HIGH: value }), {
          min: 0,
          max: 100,
          step: 1,
        })}
        {numberField(
          'Достаточный уровень, от',
          bands.SUFFICIENT,
          (value) => setBands({ ...bands, SUFFICIENT: value }),
          { min: 0, max: 100, step: 1 },
        )}
        {numberField('Пробелы, от', bands.GAPS, (value) => setBands({ ...bands, GAPS: value }), {
          min: 0,
          max: 100,
          step: 1,
        })}
        {numberField('Порог расхождения оценщиков', disagreement, setDisagreement, { min: 0.1, max: 4, step: 0.1 })}
        {numberField('Порог критической компетенции', gate, setGate, { min: 0, max: 4, step: 0.1 })}
        {numberField('Мин. покрытие данными', coverage, setCoverage, { min: 0, max: 1, step: 0.05 })}
        {numberField('Порог близости конструктов', similarity, setSimilarity, { min: 0.1, max: 1, step: 0.01 })}
        {numberField('Конструктов для лестницы (3–5)', ladder, setLadder, { min: 3, max: 5, step: 1 })}
        {numberField('Целевое число конструктов', target, setTarget, { min: 5, max: 15, step: 1 })}
      </div>
      <Notice tone="method">
        Пороги влияют только на новые расчёты. Исторические результаты не пересчитываются автоматически:
        пересчёт выполняется явной командой и сохраняет предыдущую версию расчёта.
      </Notice>
    </Card>
  );
}
