// model.js — доменная модель поручений.
// Здесь закодированы правила из регламента «Структура и порядок поручений».

// ── Категории (порядок вывода строго фиксирован регламентом) ──────────────
export const CATEGORIES = [
  { id: 'operational', title: 'Оперативные' },
  { id: 'org-tech',    title: 'Организационно-технические' },
  { id: 'commercial',  title: 'Договорно-коммерческие' },
];

export const CATEGORY_TITLE = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.title]),
);

// ── Оперативные объекты (порядок менять запрещено, Правило 1) ──────────────
// Штатный перечень. Пользовательские объекты добавляются в конец (Правило 4).
export const OPERATIONAL_OBJECTS = [
  'КП-10 — скв. 31013Г',
  'КП-17 — скв. 31708Г',
  'КП-18 — скв. 31801Г',
  'КП-2БИС — скв. 42212',
  'КП-1 — скв. 44119',
  'КП-2 — скв. 44214',
  'NP-2 — скв. N2-03',
  'EP-1 — скв. E1-25',
  'NP-3 — скв. N3-16',
  'ГЕО-12',
  '1П КК',
  'Расконсерв.',
];

// Плейсхолдеры обязательных полей (Запрет на домысливание).
export const NO_RESPONSIBLE = 'не определен';
export const NO_DEADLINE = 'не установлен';
export const NO_TASKS = 'Поручения отсутствуют.';

// ── Работа со сроком ──────────────────────────────────────────────────────
// deadline хранится как ISO-строка (напр. '2026-08-10T14:00') либо null.

export function isOverdue(task, now = new Date()) {
  if (!task.deadline) return false;
  return new Date(task.deadline).getTime() < now.getTime();
}

export function formatDeadline(deadline) {
  if (!deadline) return NO_DEADLINE;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return NO_DEADLINE;
  const date = d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  // Время показываем, только если оно задано (не 00:00).
  if (d.getHours() === 0 && d.getMinutes() === 0) return date;
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export function formatResponsible(responsible) {
  const v = (responsible || '').trim();
  return v || NO_RESPONSIBLE;
}

// ── Фильтрация действующих поручений ──────────────────────────────────────
// Поручение действует, пока пользователь явно не закрыл его.
export function isActive(task) {
  return task.status !== 'closed';
}

// ── Сортировки по категориям ──────────────────────────────────────────────

// Оперативные: порядок объектов из перечня; новые объекты — в конце.
// Возвращает упорядоченный список объектов с их поручениями.
export function groupOperational(tasks, customObjects = []) {
  const active = tasks.filter((t) => t.category === 'operational' && isActive(t));
  const order = [...OPERATIONAL_OBJECTS, ...customObjects];

  // Собираем объекты, встретившиеся в поручениях, но отсутствующие в перечне.
  const unknown = [];
  for (const t of active) {
    const obj = t.object || '';
    if (obj && !order.includes(obj) && !unknown.includes(obj)) unknown.push(obj);
  }
  const fullOrder = [...order, ...unknown];

  return fullOrder.map((obj) => ({
    object: obj,
    isCustom: !OPERATIONAL_OBJECTS.includes(obj),
    isUnplaced: unknown.includes(obj), // требует определения постоянного места
    tasks: active.filter((t) => (t.object || '') === obj),
  }));
}

// Организационно-технические: просрочка → ближайший срок → приоритет → без срока.
export function sortOrgTech(tasks, now = new Date()) {
  const active = tasks.filter((t) => t.category === 'org-tech' && isActive(t));
  return active.slice().sort((a, b) => {
    const ao = isOverdue(a, now), bo = isOverdue(b, now);
    if (ao !== bo) return ao ? -1 : 1;            // просроченные первыми
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (ad !== bd) return ad - bd;                 // ближайший срок раньше
    // при равном сроке — по приоритету (меньше число = выше приоритет)
    const ap = a.priority ?? 99, bp = b.priority ?? 99;
    return ap - bp;
  });
}

// Договорно-коммерческие: группировка контрагент → договор → срок,
// поручения с финансовым риском выводятся первыми.
export function groupCommercial(tasks, now = new Date()) {
  const active = tasks.filter((t) => t.category === 'commercial' && isActive(t));

  // Ключ группировки: контрагент → договор/проект.
  const groupsMap = new Map();
  for (const t of active) {
    const contractor = (t.contractor || '').trim() || 'Контрагент не указан';
    const contract = (t.contract || '').trim() || 'Договор/проект не указан';
    const key = `${contractor}||${contract}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { contractor, contract, tasks: [] });
    }
    groupsMap.get(key).tasks.push(t);
  }

  const groups = [...groupsMap.values()];

  // Внутри группы: финансовый риск первым, затем по сроку.
  for (const g of groups) {
    g.tasks.sort((a, b) => {
      if (!!a.financialRisk !== !!b.financialRisk) return a.financialRisk ? -1 : 1;
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd;
    });
  }

  // Группы: сначала те, где есть поручения с финансовым риском.
  groups.sort((a, b) => {
    const ar = a.tasks.some((t) => t.financialRisk);
    const br = b.tasks.some((t) => t.financialRisk);
    if (ar !== br) return ar ? -1 : 1;
    return a.contractor.localeCompare(b.contractor, 'ru');
  });

  return groups;
}

// ── Создание/валидация поручения ─────────────────────────────────────────
export function newTaskId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Приводит объект поручения к каноничному виду. Ничего не домысливает:
// отсутствующие ответственный/срок остаются пустыми (null).
export function normalizeTask(raw) {
  return {
    id: raw.id || newTaskId(),
    category: raw.category,
    text: (raw.text || '').trim(),
    responsible: (raw.responsible || '').trim() || null,
    deadline: raw.deadline || null,
    // оперативные
    object: raw.object || null,
    // орг-технические
    priority: raw.priority ?? null,
    // договорно-коммерческие
    contractor: (raw.contractor || '').trim() || null,
    contract: (raw.contract || '').trim() || null,
    financialRisk: !!raw.financialRisk,
    // общие
    note: (raw.note || '').trim() || null, // отчёт/комментарий (не закрывает поручение)
    status: raw.status === 'closed' ? 'closed' : 'active',
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Проверка обязательных полей формы. Возвращает массив сообщений об ошибках.
export function validateTask(raw) {
  const errors = [];
  if (!raw.category) errors.push('Не выбрана категория.');
  if (!(raw.text || '').trim()) errors.push('Не заполнена задача.');
  if (raw.category === 'operational' && !(raw.object || '').trim()) {
    errors.push('Для оперативного поручения не выбран объект.');
  }
  return errors;
}
