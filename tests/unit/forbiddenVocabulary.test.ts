import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_TERMS,
  PROTECTED_ATTRIBUTE_TERMS,
  findForbiddenTerms,
} from '@/lib/forbiddenVocabulary.js';
import { BAND_TITLES, LEVEL_TITLES } from '@/server/scoring/engine.js';
import { COMPETENCIES, RUBRICS } from '../../prisma/seed/catalog.js';
import { MUD_ENGINEER_SEED } from '../../prisma/seed/mudEngineer.js';
import { INTEGRATED_SERVICE_SEED } from '../../prisma/seed/integratedService.js';
import { kellyElements } from '../../prisma/seed/kelly.js';
import {
  CONSTRUCT_MAP_SYSTEM,
  DEDUP_SYSTEM,
  EVALUATOR_A_SYSTEM,
  EVALUATOR_B_SYSTEM,
  INTERVIEW_QUESTIONS_SYSTEM,
} from '@/server/llm/promptAssembly.js';
import { REPORT_DISCLAIMERS } from '@/server/services/reportService.js';
import { RISK_FLAGS } from '@/server/scoring/riskFlags.js';
import { scanSchemaFields, scanSources } from '../../scripts/vocabularyScan.js';

/**
 * Запрет диагностической и кадровой лексики (§18, §22, docs/KELLY_METHOD.md §9).
 * Проверяются seed-данные, шаблоны промптов, тексты отчёта и словарь интерфейса.
 */

describe('запрещённая лексика', () => {
  it('квалификационные категории не содержат кадрового вердикта', () => {
    for (const title of Object.values(BAND_TITLES)) {
      expect(findForbiddenTerms(title)).toEqual([]);
    }
    const serialized = Object.values(BAND_TITLES).join(' ').toLowerCase();
    expect(serialized).not.toContain('принять');
    expect(serialized).not.toContain('отказать');
    expect(serialized).not.toContain('пригоден');
  });

  it('названия уровней нейтральны', () => {
    for (const title of Object.values(LEVEL_TITLES)) {
      expect(findForbiddenTerms(title)).toEqual([]);
    }
  });

  it('каталог компетенций и rubric не содержат запрещённых формулировок', () => {
    for (const competency of COMPETENCIES) {
      expect(findForbiddenTerms(`${competency.title} ${competency.description}`)).toEqual([]);
    }
    for (const rubric of RUBRICS) {
      expect(findForbiddenTerms(rubric.guidance)).toEqual([]);
      for (const level of rubric.levels) {
        expect(findForbiddenTerms(level.descriptor)).toEqual([]);
      }
    }
  });

  it('элементы репертуарной решётки не используют оценочных ярлыков', () => {
    for (const element of kellyElements('Инженер по буровым растворам')) {
      const violations = findForbiddenTerms(`${element.label} ${element.description}`);
      expect(violations).toEqual([]);
      // Шкала не должна вводить понятия «плохой»/«хороший» специалист.
      expect(element.label.toLowerCase()).not.toMatch(/\bплохой\b|\bхороший\b/);
    }
  });

  it('кейсы и вопросы обеих должностей проходят проверку лексики', () => {
    for (const seed of [MUD_ENGINEER_SEED, INTEGRATED_SERVICE_SEED]) {
      for (const scenario of seed.scenarios) {
        const text = [
          scenario.title,
          scenario.expertNotes,
          ...scenario.expectedEvidence,
          ...scenario.unsafeActions,
          ...scenario.stages.flatMap((stage) => [
            stage.situation,
            stage.constraints ?? '',
            stage.adjacentServiceInfo ?? '',
            ...stage.questions.map((question) => `${question.prompt} ${question.helpText ?? ''}`),
          ]),
        ].join(' ');
        expect(findForbiddenTerms(text)).toEqual([]);
      }
      for (const question of seed.standaloneQuestions) {
        expect(findForbiddenTerms(`${question.prompt} ${question.helpText ?? ''}`)).toEqual([]);
      }
    }
  });

  it('шаблоны промптов запрещают кадровые и психологические выводы', () => {
    const prompts = [
      EVALUATOR_A_SYSTEM,
      EVALUATOR_B_SYSTEM,
      INTERVIEW_QUESTIONS_SYSTEM,
      DEDUP_SYSTEM,
      CONSTRUCT_MAP_SYSTEM,
    ];
    for (const prompt of prompts) {
      // Формулировки перечислены как ЗАПРЕТ, поэтому проверяем наличие запрета,
      // а не отсутствие слов.
      if (prompt === EVALUATOR_A_SYSTEM || prompt === EVALUATOR_B_SYSTEM) {
        expect(prompt).toContain('НЕ принимаешь кадровых решений');
        expect(prompt).toContain('НЕ ставишь психологических');
      }
    }
    expect(INTERVIEW_QUESTIONS_SYSTEM).toContain('не содержит оценочных суждений о человеке');
  });

  it('тексты отчёта содержат обязательные оговорки и не содержат вердикта', () => {
    expect(REPORT_DISCLAIMERS.purpose).toContain('решение о найме принимает человек');
    expect(REPORT_DISCLAIMERS.contradiction).not.toMatch(/лж|обман|неискрен/i);
    expect(REPORT_DISCLAIMERS.protectedAttributes).toContain('не используются');
    for (const disclaimer of Object.values(REPORT_DISCLAIMERS)) {
      const violations = findForbiddenTerms(disclaimer).filter(
        // Слово «диагноз» присутствует в самой оговорке о его недопустимости.
        (violation) => violation.term !== 'диагноз',
      );
      expect(violations).toEqual([]);
    }
  });

  it('маркеры риска описывают поведение, а не личность', () => {
    for (const flag of RISK_FLAGS) {
      expect(findForbiddenTerms(`${flag.title} ${flag.description}`)).toEqual([]);
    }
  });

  it('защищаемые характеристики не встречаются как поля модели данных', () => {
    // Проверяются именно объявленные поля, а не подстроки (иначе «language»
    // ложно совпадает с «age»).
    expect(scanSchemaFields()).toEqual([]);
    expect(PROTECTED_ATTRIBUTE_TERMS.length).toBeGreaterThan(0);
  });

  it('пользовательские тексты не содержат запрещённой лексики', () => {
    const { hits, scannedLiterals } = scanSources(['src']);
    // Проверка имеет смысл только если сканирование действительно нашло тексты.
    expect(scannedLiterals).toBeGreaterThan(500);
    expect(hits).toEqual([]);
  });

  it('каталог запрещённых терминов покрывает ключевые формулировки', () => {
    for (const term of ['принять на работу', 'отказать кандидату', 'психотип', 'кандидат лжёт']) {
      expect(FORBIDDEN_TERMS).toContain(term);
    }
  });
});
