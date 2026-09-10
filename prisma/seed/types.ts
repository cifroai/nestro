import type { CompetencyAxis, QuestionType, TestSection } from '@prisma/client';

/** Декларативное описание seed-содержимого. Ядро не содержит хардкода должностей. */

export interface CompetencyDef {
  code: string;
  title: string;
  description: string;
  axis: CompetencyAxis;
}

export interface RubricLevelDef {
  level: number;
  descriptor: string;
  positiveIndicators?: string[];
  negativeIndicators?: string[];
}

export interface RubricDef {
  competencyCode: string;
  guidance: string;
  levels: RubricLevelDef[];
}

export interface WeightDef {
  competencyCode: string;
  weight: number;
  isHardGate?: boolean;
  minEvidenceCount?: number;
  minQuestionCount?: number;
}

export interface KellyElementDef {
  code: string;
  label: string;
  description: string;
  isSelf?: boolean;
  isIdeal?: boolean;
}

export interface KellyTriadDef {
  code: string;
  elements: [string, string, string];
  randomizable?: boolean;
  isReserve?: boolean;
}

export interface ScenarioStageDef {
  situation: string;
  dynamics?: Array<{ label: string; unit: string; points: Array<{ t: string; value: number }> }>;
  constraints?: string;
  adjacentServiceInfo?: string;
  revealNote?: string;
  /** Вопросы этапа; competencies — какие компетенции измеряет вопрос. */
  questions: Array<{
    code: string;
    prompt: string;
    helpText?: string;
    type?: QuestionType;
    minLength?: number;
    subFields?: Array<{ key: string; label: string; required: boolean; minLength?: number }>;
    competencies: Array<{ code: string; weight?: number }>;
  }>;
}

export interface ScenarioDef {
  code: string;
  title: string;
  difficulty: number;
  equivalenceGroup?: string;
  expectedEvidence: string[];
  unsafeActions: string[];
  expertNotes: string;
  stages: ScenarioStageDef[];
}

export interface StandaloneQuestionDef {
  code: string;
  section: TestSection;
  type: QuestionType;
  prompt: string;
  helpText?: string;
  minLength?: number;
  maxLength?: number;
  options?: unknown;
  required?: boolean;
  subFields?: Array<{ key: string; label: string; required: boolean; minLength?: number }>;
  competencies: Array<{ code: string; weight?: number }>;
}

export interface PositionSeed {
  positionCode: string;
  positionTitle: string;
  family: string;
  positionDescription: string;
  assessmentCode: string;
  assessmentTitle: string;
  weights: WeightDef[];
  kellyElements: KellyElementDef[];
  kellyTriads: KellyTriadDef[];
  scenarios: ScenarioDef[];
  standaloneQuestions: StandaloneQuestionDef[];
}

/** Стандартный набор подполей ситуационного кейса (требование §10 и §11). */
export const CASE_SUBFIELDS = [
  { key: 'whatHappens', label: 'Что происходит', required: true, minLength: 60 },
  { key: 'possibleCauses', label: 'Какие возможны причины', required: true, minLength: 60 },
  { key: 'missingInformation', label: 'Какой информации не хватает', required: true, minLength: 40 },
  { key: 'checkFirst', label: 'Что проверить первым и почему', required: true, minLength: 40 },
  { key: 'actions', label: 'Какие действия выполнить', required: true, minLength: 60 },
  { key: 'forbiddenActions', label: 'Что нельзя делать', required: true, minLength: 40 },
  { key: 'notify', label: 'Кого уведомить', required: true, minLength: 20 },
  { key: 'escalationTrigger', label: 'Когда требуется эскалация', required: true, minLength: 40 },
  { key: 'successCriterion', label: 'Что считать подтверждением правильности решения', required: true, minLength: 40 },
] as const;

/** Подполя второго этапа: проверка адаптивности мышления (§10). */
export const CASE_REVISION_SUBFIELDS = [
  { key: 'decisionChange', label: 'Изменяете или подтверждаете предыдущее решение', required: true, minLength: 40 },
  { key: 'reasoning', label: 'Что именно в новых данных повлияло на вывод', required: true, minLength: 60 },
  { key: 'actions', label: 'Скорректированные действия', required: true, minLength: 60 },
  { key: 'successCriterion', label: 'Обновлённый критерий подтверждения', required: true, minLength: 40 },
] as const;
