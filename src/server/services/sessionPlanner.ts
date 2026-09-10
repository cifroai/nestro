import { pickDeterministic, shuffleDeterministic } from '../../lib/prng.js';

/**
 * Планировщик прохождения теста. Чистый детерминированный модуль:
 * от (конфигурация версии + seed + состояние ответов) однозначно зависит
 * следующий шаг. Это даёт воспроизводимость порядка (§24) и тестируемость.
 */

export const SECTION_ORDER = [
  'KELLY_TRIADS',
  'REPERTORY_GRID',
  'LADDERING',
  'SJT_CASES',
  'ARGUMENTATION',
  'SELF_RATING',
] as const;

export type PlannedSection = (typeof SECTION_ORDER)[number];

export interface TriadConfig {
  id: string;
  code: string;
  questionVersionId: string;
  randomizable: boolean;
  isReserve: boolean;
  orderIndex: number;
}

export interface StageConfig {
  id: string;
  stageIndex: number;
  questionVersionIds: string[];
}

export interface ScenarioConfig {
  id: string;
  code: string;
  equivalenceGroup: string | null;
  orderIndex: number;
  stages: StageConfig[];
}

export interface PlannerConfig {
  targetConstructCount: number;
  minConstructCount: number;
  ladderConstructCount: number;
  triads: TriadConfig[];
  gridQuestionVersionId: string | null;
  scenarios: ScenarioConfig[];
  argumentationQuestionVersionIds: string[];
  selfRatingQuestionVersionIds: string[];
}

export interface PlannerState {
  seed: string;
  /** Идентификаторы вопросов с отправленным ответом. */
  submittedQuestionVersionIds: ReadonlySet<string>;
  /** Число уникальных (не помеченных дубликатами) конструктов. */
  uniqueConstructCount: number;
  /** Есть ли неотвеченная проверка на дублирование конструкта. */
  pendingSimilarityCheckId: string | null;
  /** Заполнена ли решётка полностью. */
  gridComplete: boolean;
  /** Прогресс лестницы смыслов: конструкт → достигнутая глубина. */
  ladderDepths: ReadonlyMap<string, number>;
  /** Конструкты, отобранные для лестницы (в порядке значимости). */
  ladderConstructIds: readonly string[];
  /** Завершена ли лестница по каждому конструкту. */
  ladderCompleted: ReadonlySet<string>;
}

export type NextStep =
  | { kind: 'KELLY_TRIAD'; triadId: string; questionVersionId: string; index: number; total: number }
  | { kind: 'CONSTRUCT_SIMILARITY_CHECK'; checkId: string }
  | { kind: 'REPERTORY_GRID'; questionVersionId: string }
  | { kind: 'LADDERING'; constructId: string; depth: number }
  | {
      kind: 'CASE_STAGE';
      scenarioId: string;
      stageId: string;
      stageIndex: number;
      questionVersionIds: string[];
    }
  | { kind: 'QUESTION'; section: 'ARGUMENTATION' | 'SELF_RATING'; questionVersionId: string }
  | { kind: 'FINISH' };

/**
 * Порядок триад: неперемешиваемые идут первыми в исходном порядке
 * («разогрев»), остальные перемешиваются детерминированно, резервные —
 * в конце (docs/KELLY_METHOD.md §3).
 */
export function orderTriads(triads: TriadConfig[], seed: string): TriadConfig[] {
  const fixed = triads
    .filter((t) => !t.isReserve && !t.randomizable)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const shuffled = shuffleDeterministic(
    triads.filter((t) => !t.isReserve && t.randomizable).sort((a, b) => a.orderIndex - b.orderIndex),
    `${seed}:triads`,
  );
  const reserve = triads.filter((t) => t.isReserve).sort((a, b) => a.orderIndex - b.orderIndex);
  return [...fixed, ...shuffled, ...reserve];
}

/**
 * Выбор кейсов: из каждой группы эквивалентных сценариев берётся один
 * вариант (§24), затем порядок перемешивается детерминированно.
 */
export function selectScenarios(scenarios: ScenarioConfig[], seed: string): ScenarioConfig[] {
  const groups = new Map<string, ScenarioConfig[]>();
  const standalone: ScenarioConfig[] = [];
  for (const scenario of scenarios) {
    if (!scenario.equivalenceGroup) {
      standalone.push(scenario);
      continue;
    }
    const bucket = groups.get(scenario.equivalenceGroup);
    if (bucket) bucket.push(scenario);
    else groups.set(scenario.equivalenceGroup, [scenario]);
  }

  const chosen: ScenarioConfig[] = [...standalone];
  for (const [group, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...members].sort((a, b) => a.code.localeCompare(b.code));
    const pick = pickDeterministic(sorted, `${seed}:group:${group}`);
    if (pick) chosen.push(pick);
  }

  return shuffleDeterministic(
    chosen.sort((a, b) => a.orderIndex - b.orderIndex || a.code.localeCompare(b.code)),
    `${seed}:scenarios`,
  );
}

/** Сколько триад предъявлять: цель по конструктам плюс запас на дубликаты. */
export function triadBudget(config: PlannerConfig): number {
  return Math.min(config.triads.length, config.targetConstructCount + 3);
}

export interface SessionPlan {
  triads: TriadConfig[];
  scenarios: ScenarioConfig[];
  argumentationQuestionVersionIds: string[];
  selfRatingQuestionVersionIds: string[];
  /** Число шагов для расчёта прогресса. */
  estimatedSteps: number;
}

export function buildPlan(config: PlannerConfig, seed: string): SessionPlan {
  const triads = orderTriads(config.triads, seed);
  const scenarios = selectScenarios(config.scenarios, seed);
  const caseSteps = scenarios.reduce((acc, s) => acc + s.stages.length, 0);
  const gridSteps = config.gridQuestionVersionId ? 1 : 0;
  return {
    triads,
    scenarios,
    argumentationQuestionVersionIds: [...config.argumentationQuestionVersionIds],
    selfRatingQuestionVersionIds: [...config.selfRatingQuestionVersionIds],
    estimatedSteps:
      triadBudget(config) +
      gridSteps +
      config.ladderConstructCount +
      caseSteps +
      config.argumentationQuestionVersionIds.length +
      config.selfRatingQuestionVersionIds.length,
  };
}

/** Достаточно ли конструктов, чтобы перейти к решётке. */
export function triadsComplete(config: PlannerConfig, state: PlannerState, plan: SessionPlan): boolean {
  const answeredTriads = plan.triads.filter((t) => state.submittedQuestionVersionIds.has(t.questionVersionId));
  if (state.uniqueConstructCount >= config.targetConstructCount) return true;
  // Бюджет базовых триад исчерпан, но минимума конструктов нет — подключается резерв.
  const budget = triadBudget(config);
  if (answeredTriads.length >= budget && state.uniqueConstructCount >= config.minConstructCount) return true;
  return answeredTriads.length >= plan.triads.length;
}

/**
 * Следующий шаг прохождения. Единственная точка принятия решения о порядке,
 * что исключает расхождение между UI и сервером.
 */
export function nextStep(config: PlannerConfig, state: PlannerState, plan: SessionPlan): NextStep {
  // Незакрытая проверка на дублирование конструкта имеет наивысший приоритет:
  // объединение конструктов невозможно без ответа кандидата (§5).
  if (state.pendingSimilarityCheckId) {
    return { kind: 'CONSTRUCT_SIMILARITY_CHECK', checkId: state.pendingSimilarityCheckId };
  }

  if (!triadsComplete(config, state, plan)) {
    const budget = triadBudget(config);
    const pool = state.uniqueConstructCount >= config.minConstructCount ? plan.triads.slice(0, budget) : plan.triads;
    const nextTriad = pool.find((t) => !state.submittedQuestionVersionIds.has(t.questionVersionId));
    if (nextTriad) {
      const answered = pool.filter((t) => state.submittedQuestionVersionIds.has(t.questionVersionId)).length;
      return {
        kind: 'KELLY_TRIAD',
        triadId: nextTriad.id,
        questionVersionId: nextTriad.questionVersionId,
        index: answered + 1,
        total: Math.max(budget, answered + 1),
      };
    }
  }

  if (config.gridQuestionVersionId && !state.gridComplete) {
    return { kind: 'REPERTORY_GRID', questionVersionId: config.gridQuestionVersionId };
  }

  for (const constructId of state.ladderConstructIds.slice(0, config.ladderConstructCount)) {
    if (state.ladderCompleted.has(constructId)) continue;
    const depth = state.ladderDepths.get(constructId) ?? 0;
    return { kind: 'LADDERING', constructId, depth: depth + 1 };
  }

  for (const scenario of plan.scenarios) {
    for (const stage of [...scenario.stages].sort((a, b) => a.stageIndex - b.stageIndex)) {
      const allAnswered = stage.questionVersionIds.every((id) => state.submittedQuestionVersionIds.has(id));
      if (!allAnswered) {
        return {
          kind: 'CASE_STAGE',
          scenarioId: scenario.id,
          stageId: stage.id,
          stageIndex: stage.stageIndex,
          questionVersionIds: stage.questionVersionIds,
        };
      }
    }
  }

  for (const questionVersionId of plan.argumentationQuestionVersionIds) {
    if (!state.submittedQuestionVersionIds.has(questionVersionId)) {
      return { kind: 'QUESTION', section: 'ARGUMENTATION', questionVersionId };
    }
  }

  for (const questionVersionId of plan.selfRatingQuestionVersionIds) {
    if (!state.submittedQuestionVersionIds.has(questionVersionId)) {
      return { kind: 'QUESTION', section: 'SELF_RATING', questionVersionId };
    }
  }

  return { kind: 'FINISH' };
}

/** Прогресс в процентах для UI кандидата (§25). */
export function computeProgress(config: PlannerConfig, state: PlannerState, plan: SessionPlan): number {
  const completedTriads = plan.triads.filter((t) =>
    state.submittedQuestionVersionIds.has(t.questionVersionId),
  ).length;
  const completedGrid = state.gridComplete ? 1 : 0;
  const completedLadder = state.ladderConstructIds
    .slice(0, config.ladderConstructCount)
    .filter((id) => state.ladderCompleted.has(id)).length;
  const completedCases = plan.scenarios.reduce(
    (acc, s) =>
      acc +
      s.stages.filter((stage) =>
        stage.questionVersionIds.every((id) => state.submittedQuestionVersionIds.has(id)),
      ).length,
    0,
  );
  const completedOther = [
    ...plan.argumentationQuestionVersionIds,
    ...plan.selfRatingQuestionVersionIds,
  ].filter((id) => state.submittedQuestionVersionIds.has(id)).length;

  const done = completedTriads + completedGrid + completedLadder + completedCases + completedOther;
  if (plan.estimatedSteps <= 0) return 0;
  return Math.min(100, Math.round((done / plan.estimatedSteps) * 100));
}

/** Текущая секция — производная от следующего шага. */
export function sectionOf(step: NextStep): PlannedSection | 'FINISH' {
  switch (step.kind) {
    case 'KELLY_TRIAD':
    case 'CONSTRUCT_SIMILARITY_CHECK':
      return 'KELLY_TRIADS';
    case 'REPERTORY_GRID':
      return 'REPERTORY_GRID';
    case 'LADDERING':
      return 'LADDERING';
    case 'CASE_STAGE':
      return 'SJT_CASES';
    case 'QUESTION':
      return step.section;
    case 'FINISH':
      return 'FINISH';
  }
}
