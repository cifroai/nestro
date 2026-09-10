/**
 * Запрещённая лексика (docs/KELLY_METHOD.md §9, docs/SCORING.md §9).
 * Проверяется тестом tests/unit/forbiddenVocabulary.test.ts по UI-словарю,
 * шаблонам промптов и seed-данным.
 */
export const FORBIDDEN_TERMS: string[] = [
  // Кадровый вердикт — система его не выносит (§18).
  'принять на работу',
  'отказать кандидату',
  'пригоден',
  'непригоден',
  'рекомендуем нанять',
  'не рекомендуем нанимать',
  // Психодиагностика — вне назначения системы (§1).
  'тип личности',
  'психотип',
  'психологический диагноз',
  'диагноз',
  'интроверт',
  'экстраверт',
  // Оценочные суждения о человеке (§6, §51).
  'плохой специалист',
  'хороший специалист',
  'плохой кандидат',
  'хороший кандидат',
  'плохой человек',
  'хороший человек',
  // Недопустимые формулировки о достоверности (§22).
  'кандидат лжёт',
  'кандидат лжет',
  'неискренен',
  'обманывает',
];

/** Защищаемые характеристики — не собираются и не участвуют в оценке (§44). */
export const PROTECTED_ATTRIBUTE_TERMS: string[] = [
  'национальность',
  'вероисповедание',
  'религия',
  'политические взгляды',
  'семейное положение',
  'состояние здоровья',
  'инвалидность',
  'возраст кандидата',
  'пол кандидата',
];

export interface VocabularyViolation {
  term: string;
  context: string;
}

export function findForbiddenTerms(
  text: string,
  terms: string[] = FORBIDDEN_TERMS,
): VocabularyViolation[] {
  const haystack = text.toLowerCase();
  const violations: VocabularyViolation[] = [];
  for (const term of terms) {
    const idx = haystack.indexOf(term.toLowerCase());
    if (idx >= 0) {
      violations.push({
        term,
        context: text.slice(Math.max(0, idx - 40), idx + term.length + 40).replace(/\s+/g, ' '),
      });
    }
  }
  return violations;
}
