/**
 * Каталог профессиональных маркеров риска (§20) и детерминированные детекторы.
 * Ни один флаг не создаётся без ссылки на конкретный ответ (§20, §66).
 */

export type FlagSeverityCode = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskFlagDefinition {
  code: string;
  title: string;
  description: string;
  defaultSeverity: FlagSeverityCode;
  /** RULE — детектируется кодом, LLM — оценщиком с обязательной цитатой. */
  detector: 'RULE' | 'LLM';
}

export const RISK_FLAGS: RiskFlagDefinition[] = [
  {
    code: 'DECIDES_WITHOUT_DATA',
    title: 'Принимает решение без необходимых данных',
    description: 'Предлагает воздействие, не запросив параметры, необходимые для диагностики.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'DENIES_UNCERTAINTY',
    title: 'Не признаёт неопределённость',
    description: 'Формулирует единственную причину как достоверную без оснований.',
    defaultSeverity: 'MEDIUM',
    detector: 'LLM',
  },
  {
    code: 'IGNORES_RISK',
    title: 'Игнорирует риск',
    description: 'Не оценивает последствия предлагаемого действия для скважины и персонала.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'CAUSE_SYMPTOM_CONFUSION',
    title: 'Не различает причину и симптом',
    description: 'Называет наблюдаемый показатель причиной осложнения.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'PROCEDURE_VIOLATION_UNASSESSED',
    title: 'Нарушает процедуру без оценки последствий',
    description: 'Отклоняется от программы без анализа риска и уведомления.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'AVOIDS_DECISIONS',
    title: 'Полностью избегает самостоятельных решений',
    description: 'Во всех ситуациях передаёт решение вышестоящему без собственного анализа.',
    defaultSeverity: 'MEDIUM',
    detector: 'LLM',
  },
  {
    code: 'ACTS_BEYOND_AUTHORITY',
    title: 'Действует за пределами полномочий без эскалации',
    description: 'Принимает решения, требующие согласования, не уведомляя ответственных.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'SILO_FOCUS',
    title: 'Фокусируется только на своей функции',
    description: 'Оптимизирует собственный сервис в ущерб результату строительства скважины.',
    defaultSeverity: 'MEDIUM',
    detector: 'LLM',
  },
  {
    code: 'NO_RESULT_CONTROL',
    title: 'Не контролирует эффект собственного решения',
    description: 'Не указывает, как будет проверен результат воздействия.',
    defaultSeverity: 'MEDIUM',
    detector: 'LLM',
  },
  {
    code: 'BLAME_SEEKING',
    title: 'Ищет виновного вместо причины',
    description: 'Объяснение события сводится к персональной ответственности других.',
    defaultSeverity: 'MEDIUM',
    detector: 'LLM',
  },
  {
    code: 'SAFETY_RULE',
    title: 'Техническое решение с недооценённым риском безопасности',
    description: 'Предлагаемое действие входит в перечень небезопасных для данного кейса.',
    defaultSeverity: 'HIGH',
    detector: 'LLM',
  },
  {
    code: 'NO_EXPERIENCE_EXAMPLE',
    title: 'Не приводит примеры из собственного опыта',
    description: 'В большинстве триад отсутствует конкретный пример из практики.',
    defaultSeverity: 'MEDIUM',
    detector: 'RULE',
  },
  {
    code: 'GENERIC_ANSWERS',
    title: 'Описывает результат исключительно общими словами',
    description: 'Открытые ответы систематически короткие и без конкретных показателей.',
    defaultSeverity: 'MEDIUM',
    detector: 'RULE',
  },
  {
    code: 'NO_MISSING_DATA_REQUEST',
    title: 'Не запрашивает недостающие данные',
    description: 'Ни в одном кейсе не указано, какой информации не хватает для решения.',
    defaultSeverity: 'MEDIUM',
    detector: 'RULE',
  },
  {
    code: 'NO_SUCCESS_CRITERION',
    title: 'Не определяет критерий успешности решения',
    description: 'Ни в одном кейсе не указано, что считать подтверждением правильности действий.',
    defaultSeverity: 'MEDIUM',
    detector: 'RULE',
  },
  {
    code: 'NO_ESCALATION_MENTION',
    title: 'Не определяет момент эскалации',
    description: 'Ни в одном кейсе не указано, когда ситуация требует эскалации.',
    defaultSeverity: 'HIGH',
    detector: 'RULE',
  },
  {
    code: 'GRID_NO_DISCRIMINATION',
    title: 'Решётка заполнена без различения элементов',
    description: 'Подавляющая часть клеток репертуарной решётки имеет одно значение.',
    defaultSeverity: 'LOW',
    detector: 'RULE',
  },
  {
    code: 'EXTREME_POLARIZATION',
    title: 'Крайняя поляризация оценок',
    description: 'Почти все оценки решётки — крайние значения шкалы.',
    defaultSeverity: 'LOW',
    detector: 'RULE',
  },
];

export const RISK_FLAG_BY_CODE = new Map(RISK_FLAGS.map((f) => [f.code, f]));
export const LLM_FLAG_CODES = RISK_FLAGS.filter((f) => f.detector === 'LLM').map((f) => f.code);
export const RULE_FLAG_CODES = RISK_FLAGS.filter((f) => f.detector === 'RULE').map((f) => f.code);

// ─────────────────────────────────────────────────────────────────────────────
// Детерминированные детекторы (docs/SCORING.md §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface TriadAnswerSnapshot {
  answerId: string;
  experienceExample: string | null;
}

export interface CaseAnswerSnapshot {
  answerId: string;
  /** Значения обязательных подполей структуры рассуждения (§11). */
  missingInformation: string | null;
  successCriterion: string | null;
  escalationTrigger: string | null;
}

export interface OpenAnswerSnapshot {
  answerId: string;
  text: string;
}

export interface GridSnapshot {
  /** Значения всех заполненных клеток решётки. */
  ratings: number[];
}

export interface SessionSnapshot {
  triadAnswers: TriadAnswerSnapshot[];
  caseAnswers: CaseAnswerSnapshot[];
  openAnswers: OpenAnswerSnapshot[];
  grid: GridSnapshot;
}

export interface RiskFlagDraft {
  code: string;
  severity: FlagSeverityCode;
  answerId: string | null;
  quote: string | null;
  explanation: string;
  source: 'RULE';
}

const MIN_EXAMPLE_CHARS = 80;
const MIN_GENERIC_ANSWER_CHARS = 120;
const MIN_OPEN_ANSWERS_FOR_GENERIC = 10;

function flag(
  code: string,
  answerId: string | null,
  explanation: string,
  quote: string | null = null,
): RiskFlagDraft {
  const def = RISK_FLAG_BY_CODE.get(code);
  if (!def) throw new Error(`Неизвестный код маркера риска: ${code}`);
  return { code, severity: def.defaultSeverity, answerId, quote, explanation, source: 'RULE' };
}

/**
 * Детекторы, не зависящие от LLM. Дают независимый источник оценки и
 * работают даже при недоступности провайдера (§74).
 */
export function detectRuleFlags(snapshot: SessionSnapshot): RiskFlagDraft[] {
  const flags: RiskFlagDraft[] = [];

  // NO_EXPERIENCE_EXAMPLE — пример из опыта отсутствует в ≥50% триад.
  if (snapshot.triadAnswers.length > 0) {
    const weak = snapshot.triadAnswers.filter(
      (t) => (t.experienceExample ?? '').trim().length < MIN_EXAMPLE_CHARS,
    );
    if (weak.length / snapshot.triadAnswers.length >= 0.5) {
      flags.push(
        flag(
          'NO_EXPERIENCE_EXAMPLE',
          weak[0]?.answerId ?? null,
          `Пример из собственного опыта отсутствует или короче ${MIN_EXAMPLE_CHARS} символов в ${weak.length} из ${snapshot.triadAnswers.length} триад.`,
        ),
      );
    }
  }

  // Обязательные элементы структуры рассуждения в кейсах.
  if (snapshot.caseAnswers.length > 0) {
    const checks: Array<[string, keyof CaseAnswerSnapshot, string]> = [
      ['NO_MISSING_DATA_REQUEST', 'missingInformation', 'какой информации не хватает'],
      ['NO_SUCCESS_CRITERION', 'successCriterion', 'критерий подтверждения правильности решения'],
      ['NO_ESCALATION_MENTION', 'escalationTrigger', 'когда требуется эскалация'],
    ];
    for (const [code, field, label] of checks) {
      const anyFilled = snapshot.caseAnswers.some(
        (c) => ((c[field] as string | null) ?? '').trim().length > 0,
      );
      if (!anyFilled) {
        flags.push(
          flag(
            code,
            snapshot.caseAnswers[0]?.answerId ?? null,
            `Ни в одном из ${snapshot.caseAnswers.length} кейсов не заполнено поле «${label}».`,
          ),
        );
      }
    }
  }

  // GENERIC_ANSWERS — систематически короткие открытые ответы.
  if (snapshot.openAnswers.length >= MIN_OPEN_ANSWERS_FOR_GENERIC) {
    const lengths = snapshot.openAnswers.map((a) => a.text.trim().length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    if (avg < MIN_GENERIC_ANSWER_CHARS) {
      const shortest = [...snapshot.openAnswers].sort(
        (a, b) => a.text.trim().length - b.text.trim().length,
      )[0];
      flags.push(
        flag(
          'GENERIC_ANSWERS',
          shortest?.answerId ?? null,
          `Средняя длина открытых ответов ${Math.round(avg)} символов при ${snapshot.openAnswers.length} вопросах.`,
          shortest ? shortest.text.trim().slice(0, 200) : null,
        ),
      );
    }
  }

  // Стиль заполнения решётки.
  const ratings = snapshot.grid.ratings;
  if (ratings.length >= 20) {
    const counts = new Map<number, number>();
    for (const r of ratings) counts.set(r, (counts.get(r) ?? 0) + 1);
    const maxSame = Math.max(...counts.values());
    if (maxSame / ratings.length >= 0.8) {
      flags.push(
        flag(
          'GRID_NO_DISCRIMINATION',
          null,
          `${Math.round((maxSame / ratings.length) * 100)}% клеток решётки имеют одинаковое значение.`,
        ),
      );
    }
    const extremes = ratings.filter((r) => r === 1 || r === 7).length;
    if (extremes / ratings.length >= 0.85) {
      flags.push(
        flag(
          'EXTREME_POLARIZATION',
          null,
          `${Math.round((extremes / ratings.length) * 100)}% оценок решётки — крайние значения шкалы.`,
        ),
      );
    }
  }

  return flags;
}
