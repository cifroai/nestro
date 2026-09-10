import { describe, expect, it } from 'vitest';
import {
  centeredCosine,
  clusterConstructs,
  computeGridMetrics,
  constructSimilarities,
  elementDistance,
  GRID_DISCLAIMER,
  pearson,
  reflectionSignal,
  type GridMatrix,
} from '@/server/kelly/grid.js';
import {
  DUPLICATE_QUESTION,
  findPotentialDuplicate,
  lexicalSimilarity,
} from '@/server/kelly/similarity.js';
import {
  classifyLadderTerminal,
  MAX_LADDER_DEPTH,
  nextLadderStep,
  selectLadderConstructs,
} from '@/server/kelly/laddering.js';
import { shuffleDeterministic } from '@/lib/prng.js';

const ELEMENTS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10'];

function matrix(rows: Array<{ id: string; values: Array<number | null> }>): GridMatrix {
  return {
    elementCodes: ELEMENTS,
    selfElementCode: 'E10',
    idealElementCode: 'E9',
    bestElementCode: 'E1',
    weakElementCode: 'E8',
    rows: rows.map((r) => ({
      constructId: r.id,
      poleLeft: `левый ${r.id}`,
      poleRight: `правый ${r.id}`,
      values: r.values,
    })),
  };
}

describe('elementDistance', () => {
  it('считает манхэттенское и евклидово расстояния с нормировкой', () => {
    const g = matrix([
      { id: 'c1', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 7] },
      { id: 'c2', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 4] },
    ]);
    const d = elementDistance(g, 'E10', 'E9');
    // |7-1| + |4-1| = 9; максимум 2*6 = 12
    expect(d?.manhattan).toBe(9);
    expect(d?.manhattanNormalized).toBe(0.75);
    expect(d?.euclidean).toBeCloseTo(Math.sqrt(36 + 9), 3);
    expect(d?.comparedConstructs).toBe(2);
  });

  it('нулевое расстояние при совпадении элементов', () => {
    const g = matrix([{ id: 'c1', values: [4, 4, 4, 4, 4, 4, 4, 4, 3, 3] }]);
    expect(elementDistance(g, 'E10', 'E9')?.manhattan).toBe(0);
  });

  it('пропущенные клетки исключаются из сравнения', () => {
    const g = matrix([
      { id: 'c1', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, null] },
      { id: 'c2', values: [1, 1, 1, 1, 1, 1, 1, 1, 2, 5] },
    ]);
    const d = elementDistance(g, 'E10', 'E9');
    expect(d?.comparedConstructs).toBe(1);
    expect(d?.manhattan).toBe(3);
  });

  it('возвращает null для неизвестного элемента', () => {
    const g = matrix([{ id: 'c1', values: ELEMENTS.map(() => 4) }]);
    expect(elementDistance(g, 'E10', 'E99')).toBeNull();
  });
});

describe('корреляции и косинус', () => {
  it('полная прямая связь даёт r = 1', () => {
    expect(pearson([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe(1);
  });

  it('полная обратная связь даёт r = -1', () => {
    expect(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBe(-1);
  });

  it('нулевая дисперсия даёт null, а не деление на ноль', () => {
    expect(pearson([4, 4, 4, 4], [1, 2, 3, 4])).toBeNull();
    expect(centeredCosine([4, 4, 4, 4], [1, 2, 3, 4])).toBeNull();
  });

  it('центрированный косинус устойчив к сдвигу шкалы', () => {
    const a = [1, 3, 5, 7];
    const b = a.map((v) => v + 2);
    expect(centeredCosine(a, b)).toBe(1);
  });
});

describe('constructSimilarities и кластеризация', () => {
  it('помечает потенциальные дубли при |r| >= 0.8', () => {
    const g = matrix([
      { id: 'c1', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 4] },
      { id: 'c2', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 5] },
      { id: 'c3', values: [7, 1, 4, 2, 6, 3, 5, 1, 7, 2] },
    ]);
    const sims = constructSimilarities(g);
    const pair = sims.find((s) => s.constructAId === 'c1' && s.constructBId === 'c2');
    expect(pair?.potentialDuplicate).toBe(true);
    expect(pair?.correlation).toBeGreaterThan(0.9);
  });

  it('обратно связанные конструкты помечаются как inverted', () => {
    const g = matrix([
      { id: 'c1', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 4] },
      { id: 'c2', values: [7, 6, 5, 4, 3, 2, 1, 1, 7, 4] },
    ]);
    const pair = constructSimilarities(g)[0];
    expect(pair?.inverted).toBe(true);
    expect(pair?.potentialDuplicate).toBe(true);
  });

  it('объединяет близкие конструкты в кластер', () => {
    const g = matrix([
      { id: 'c1', values: [1, 2, 3, 4, 5, 6, 7, 7, 1, 4] },
      { id: 'c2', values: [1, 2, 3, 4, 5, 6, 7, 6, 1, 4] },
      { id: 'c3', values: [4, 4, 1, 7, 2, 5, 3, 6, 7, 1] },
    ]);
    const clusters = clusterConstructs(g, constructSimilarities(g));
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0]?.members).toEqual(['c1', 'c2']);
  });
});

describe('computeGridMetrics', () => {
  const g = matrix([
    { id: 'c1', values: [2, 6, 5, 1, 3, 2, 4, 7, 1, 4] },
    { id: 'c2', values: [1, 7, 4, 2, 3, 2, 5, 7, 1, 3] },
    { id: 'c3', values: [3, 5, 4, 2, 2, 1, 6, 6, 2, 5] },
    { id: 'c4', values: [1, 6, 5, 1, 4, 3, 4, 7, 1, 4] },
  ]);

  it('возвращает обязательный дисклеймер и версию движка', () => {
    const m = computeGridMetrics(g);
    expect(m.disclaimer).toBe(GRID_DISCLAIMER);
    expect(m.disclaimer).toContain('не являются психологическим диагнозом');
    expect(m.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('считает все требуемые расстояния Я↔Идеал, Я↔Лучший, Я↔E8', () => {
    const m = computeGridMetrics(g);
    expect(m.distances.selfToIdeal).not.toBeNull();
    expect(m.distances.selfToBest).not.toBeNull();
    expect(m.distances.selfToWeak).not.toBeNull();
    expect(m.selfIdealGap).toBeGreaterThan(0);
  });

  it('считает распределение и поляризацию', () => {
    const m = computeGridMetrics(g);
    const sum = Object.values(m.distribution).reduce((a, b) => a + b, 0);
    expect(sum).toBe(m.filledCells);
    expect(m.polarization).toBeGreaterThanOrEqual(0);
    expect(m.polarization).toBeLessThanOrEqual(1);
  });

  it('выдаёт значимость конструктов для отбора в лестницу', () => {
    const m = computeGridMetrics(g);
    expect(m.constructSignificance).toHaveLength(4);
    for (const s of m.constructSignificance) {
      expect(s.discriminationPower).toBeGreaterThanOrEqual(0);
      expect(s.discriminationPower).toBeLessThanOrEqual(1);
    }
  });

  it('reflectionSignal максимален при умеренном разрыве и падает на крайностях', () => {
    expect(reflectionSignal(0.35)).toBe(1);
    expect(reflectionSignal(0)).toBeLessThan(0.5);
    expect(reflectionSignal(1)).toBeLessThan(reflectionSignal(0.35));
  });

  it('детерминизм при повторном вызове', () => {
    expect(JSON.stringify(computeGridMetrics(g))).toBe(JSON.stringify(computeGridMetrics(g)));
  });
});

describe('детекция дублирующих конструктов', () => {
  const base = {
    id: 'c1',
    poleLeft: 'работает на предупреждение осложнения',
    poleRight: 'реагирует после возникновения осложнения',
    importanceReason: 'предупреждение снижает риск аварии на скважине',
    rigManifestation: 'заранее корректирует параметры промывочной жидкости',
  };

  it('находит смысловую близость «работает на предупреждение» и «видит проблему заранее»', () => {
    const other = {
      id: 'c2',
      poleLeft: 'работает на предупреждение проблемы',
      poleRight: 'реагирует после возникновения проблемы',
      importanceReason: 'предупреждение снижает риск осложнения на скважине',
      rigManifestation: 'заранее корректирует параметры раствора',
    };
    const { score } = lexicalSimilarity(base, other);
    expect(score).toBeGreaterThan(0.62);
    const found = findPotentialDuplicate(other, [base]);
    expect(found?.otherConstructId).toBe('c1');
  });

  it('не считает дублем содержательно иной конструкт', () => {
    const other = {
      id: 'c3',
      poleLeft: 'подробно документирует решения',
      poleRight: 'не фиксирует принятые решения',
      importanceReason: 'передача смены требует полной информации',
      rigManifestation: 'ведёт суточный отчёт по каждому изменению',
    };
    expect(findPotentialDuplicate(other, [base])).toBeNull();
  });

  it('распознаёт инвертированные полюса', () => {
    const inverted = {
      id: 'c4',
      poleLeft: 'реагирует после возникновения осложнения',
      poleRight: 'работает на предупреждение осложнения',
      importanceReason: 'предупреждение снижает риск аварии на скважине',
      rigManifestation: 'заранее корректирует параметры промывочной жидкости',
    };
    const { polesInverted, score } = lexicalSimilarity(base, inverted);
    expect(polesInverted).toBe(true);
    expect(score).toBeGreaterThan(0.62);
  });

  it('вопрос кандидату сформулирован нейтрально и не объединяет конструкты сам', () => {
    expect(DUPLICATE_QUESTION).toBe('Эти критерии для вас означают одно и то же или являются разными?');
    expect(DUPLICATE_QUESTION).not.toMatch(/объедин|слит|удал/i);
  });
});

describe('laddering', () => {
  it('отбирает конструкты по значимости детерминированно', () => {
    const selection = selectLadderConstructs(
      [
        { constructId: 'c1', candidateImportanceRank: 1, discriminationPower: 0.9, selfIdealDistance: 0.8 },
        { constructId: 'c2', candidateImportanceRank: 5, discriminationPower: 0.2, selfIdealDistance: 0.1 },
        { constructId: 'c3', candidateImportanceRank: 2, discriminationPower: 0.7, selfIdealDistance: 0.5 },
      ],
      2,
    );
    expect(selection.map((s) => s.constructId)).toEqual(['c1', 'c3']);
  });

  it('глубина ограничена пятью уровнями', () => {
    const steps = Array.from({ length: MAX_LADDER_DEPTH }, (_, i) => ({
      depth: i + 1,
      answer: 'подробный содержательный ответ про снижение риска осложнения на скважине',
    }));
    const next = nextLadderStep(steps);
    expect(next.shouldContinue).toBe(false);
    expect(next.reason).toBe('MAX_DEPTH');
  });

  it('запрошенная глубина не может превысить жёсткий лимит', () => {
    const steps = Array.from({ length: MAX_LADDER_DEPTH }, (_, i) => ({ depth: i + 1, answer: 'достаточно длинный содержательный ответ' }));
    expect(nextLadderStep(steps, 99).shouldContinue).toBe(false);
  });

  it('два коротких ответа подряд завершают лестницу с пометкой terminatedEarly', () => {
    const next = nextLadderStep([
      { depth: 1, answer: 'важно' },
      { depth: 2, answer: 'просто' },
    ]);
    expect(next.shouldContinue).toBe(false);
    expect(next.reason).toBe('SHORT_ANSWERS');
    expect(next.terminatedEarly).toBe(true);
  });

  it('продолжает при содержательных ответах', () => {
    const next = nextLadderStep([
      { depth: 1, answer: 'потому что раннее выявление тенденции снижает вероятность прихвата' },
    ]);
    expect(next.shouldContinue).toBe(true);
    expect(next.nextDepth).toBe(2);
    expect(next.question).toBe('Почему для вас это важно?');
  });

  it('классифицирует достигнутый уровень цепочки смыслов', () => {
    expect(classifyLadderTerminal(['иначе сорвём сроки строительства скважины'])).toBe('WELL_OUTCOME');
    expect(classifyLadderTerminal(['иначе возможен прихват колонны'])).toBe('RISK');
    expect(classifyLadderTerminal(['нужно скорректировать обработку'])).toBe('ACTION');
    expect(classifyLadderTerminal(['важно смотреть параметр плотности'])).toBe('METRIC');
    expect(classifyLadderTerminal(['не знаю'])).toBeNull();
  });
});

describe('детерминированная рандомизация', () => {
  it('одинаковый seed даёт одинаковый порядок', () => {
    const items = ['T1', 'T2', 'T3', 'T4', 'T5'];
    expect(shuffleDeterministic(items, 'seed-a')).toEqual(shuffleDeterministic(items, 'seed-a'));
  });

  it('разные seed дают разный порядок', () => {
    const items = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
    expect(shuffleDeterministic(items, 'seed-a')).not.toEqual(shuffleDeterministic(items, 'seed-b'));
  });

  it('не мутирует исходный массив и сохраняет состав', () => {
    const items = ['a', 'b', 'c'];
    const shuffled = shuffleDeterministic(items, 's');
    expect(items).toEqual(['a', 'b', 'c']);
    expect([...shuffled].sort()).toEqual(['a', 'b', 'c']);
  });
});
