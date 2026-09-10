import { cosineSimilarity, tokenize } from '../kelly/text.js';
import { round3 } from '../scoring/round.js';

/**
 * Сопоставление персонального конструкта кандидата с компетенцией модели.
 * Нужно для проверки согласованности «декларация ↔ решения в кейсах» (§22).
 *
 * Реализовано детерминированно (лексически), чтобы проверка работала и при
 * недоступности LLM. Сопоставление всегда сопровождается цитатой —
 * формулировкой самого кандидата, — поэтому вывод остаётся проверяемым (§66).
 */

export interface CompetencyTextProfile {
  code: string;
  title: string;
  description: string;
  /** Дополнительные характерные термины предметной области. */
  keywords?: string[];
}

export interface ConstructForMapping {
  id: string;
  poleLeft: string;
  poleRight: string;
  importanceReason: string | null;
  rigManifestation: string | null;
  importanceRank: number | null;
}

export interface ConstructMapping {
  constructId: string;
  competencyCode: string;
  score: number;
  /** Цитата из формулировки кандидата — основание сопоставления. */
  quote: string;
}

export const MAPPING_THRESHOLD = 0.18;

/**
 * Характерные термины по компетенциям. Список расширяем администратором
 * через справочник компетенций; здесь — базовый профессиональный словарь.
 */
export const COMPETENCY_KEYWORDS: Record<string, string[]> = {
  PREVENTION: ['предупрежд', 'заранее', 'предпосылк', 'тенденц', 'до возникновения', 'превентив', 'профилактик'],
  CAUSAL: ['причин', 'следствие', 'симптом', 'гипотез', 'разбор', 'механизм', 'почему'],
  MUD_SYSTEM: ['раствор', 'реолог', 'вязкост', 'плотност', 'фильтрац', 'корка', 'обработк', 'параметр'],
  HOLE_CLEANING: ['очистка ствола', 'вынос шлама', 'расход', 'промывк', 'циркуляц', 'вращен', 'шлам'],
  SOLIDS_CONTROL: ['твердая фаза', 'твёрдая фаза', 'вибросито', 'центрифуг', 'очистное оборудование', 'разбавлен'],
  DATA_TRENDS: ['данн', 'тренд', 'тенденц', 'динамик', 'замер', 'показател', 'суточн'],
  DECISION: ['решени', 'выбор', 'приоритет', 'критерий', 'действ', 'план'],
  RISK_ESCALATION: ['риск', 'эскалац', 'полномоч', 'уведом', 'доклад', 'остановк', 'безопасн'],
  ESCALATION: ['эскалац', 'уведом', 'доклад', 'полномоч', 'согласован', 'руководител'],
  COMMUNICATION: ['коммуникац', 'аргумент', 'объясн', 'договор', 'убеди', 'взаимодейств', 'бригад'],
  DOCUMENTATION: ['документ', 'фиксац', 'запис', 'отчёт', 'отчет', 'передача смены', 'журнал'],
  ECONOMICS: ['стоимост', 'экономи', 'затрат', 'бюджет', 'потер', 'эффективност'],
  LESSONS: ['урок', 'вывод', 'опыт', 'рефлекс', 'изменил', 'разбор события', 'ошибк'],
  SYSTEMS_THINKING: ['систем', 'в целом', 'общий результат', 'скважин', 'комплексн', 'цепочк'],
  CROSS_SERVICE: ['сервис', 'смежн', 'подрядчик', 'зависимост', 'конфликт', 'взаимодейств'],
  RISK_PREVENTION: ['риск', 'прогноз', 'предотвращ', 'предупрежд', 'заранее'],
  NPT_SPEED: ['нпв', 'непроизводительн', 'скорост', 'график', 'срок', 'время'],
  CONTRACTOR_MGMT: ['подрядчик', 'требован', 'контрол', 'исполнен', 'договор'],
};

function competencyTokens(profile: CompetencyTextProfile): string[] {
  const keywords = profile.keywords ?? COMPETENCY_KEYWORDS[profile.code] ?? [];
  return tokenize(`${profile.title} ${profile.description} ${keywords.join(' ')}`);
}

/**
 * Возвращает наиболее подходящую компетенцию для каждого конструкта.
 * Конструкты без уверенного соответствия не сопоставляются вовсе —
 * лучше отсутствие вывода, чем вывод без основания.
 */
export function mapConstructsToCompetencies(
  constructs: ConstructForMapping[],
  competencies: CompetencyTextProfile[],
  threshold: number = MAPPING_THRESHOLD,
): ConstructMapping[] {
  const profiles = competencies.map((c) => ({ code: c.code, tokens: competencyTokens(c) }));
  const result: ConstructMapping[] = [];

  for (const construct of constructs) {
    const constructText = [
      construct.poleLeft,
      construct.poleRight,
      construct.importanceReason ?? '',
      construct.rigManifestation ?? '',
    ].join(' ');
    const tokens = tokenize(constructText);
    if (tokens.length === 0) continue;

    let best: { code: string; score: number } | null = null;
    for (const profile of profiles) {
      const score = cosineSimilarity(tokens, profile.tokens);
      if (!best || score > best.score) best = { code: profile.code, score };
    }
    if (!best || best.score < threshold) continue;

    result.push({
      constructId: construct.id,
      competencyCode: best.code,
      score: round3(best.score),
      quote: `${construct.poleLeft} ↔ ${construct.poleRight}`,
    });
  }

  return result;
}
