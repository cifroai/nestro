// model.js — доменная модель поручений.
// Здесь закодированы правила из регламента «Структура и порядок поручений»
// и расширения второй редакции: исполнители, контролёр, перенос сроков,
// вид отчёта, напоминания.

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

// Виды отчёта об исполнении.
export const REPORT_TYPES = [
  { id: 'none',  title: 'Не требуется' },
  { id: 'text',  title: 'Текстовый отчёт' },
  { id: 'file',  title: 'Файл (документ)' },
  { id: 'photo', title: 'Фото' },
  { id: 'other', title: 'Иное (уточнить)' },
];
export const REPORT_TYPE_TITLE = Object.fromEntries(REPORT_TYPES.map((r) => [r.id, r.title]));

// Плейсхолдеры обязательных полей (Запрет на домысливание).
export const NO_RESPONSIBLE = 'не определен';
export const NO_DEADLINE = 'не установлен';
export const NO_TASKS = 'Поручения отсутствуют.';

// ── Работа со сроком ──────────────────────────────────────────────────────
export function isOverdue(task, now = new Date()) {
  if (!task.deadline) return false;
  return new Date(task.deadline).getTime() < now.getTime();
}

export function formatDeadline(deadline) {
  if (!deadline) return NO_DEADLINE;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return NO_DEADLINE;
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (d.getHours() === 0 && d.getMinutes() === 0) return date;
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// ── Исполнители ────────────────────────────────────────────────────────────
// assignees: [{id, name}]. Один — индивидуально; двое и более — поровну.
export function formatAssignees(task) {
  const list = task.assignees || [];
  if (!list.length) return NO_RESPONSIBLE;
  const names = list.map((a) => a.name).join(', ');
  return list.length > 1 ? `${names} (поровну)` : names;
}

// ── Действующие поручения ──────────────────────────────────────────────────
export function isActive(task) {
  return task.status !== 'closed';
}

// ── Права/роли для конкретного поручения (по действующему лицу) ────────────
export function isAssignee(task, userId) {
  return (task.assignees || []).some((a) => a.id === userId);
}
export function isController(task, userId) {
  return task.controllerId === userId;
}
export function isAuthor(task, userId) {
  return task.createdById === userId;
}

// ── Перенос срока ──────────────────────────────────────────────────────────
export function hasPendingExtension(task) {
  return task.extension && task.extension.status === 'pending';
}

// ── Напоминания ────────────────────────────────────────────────────────────
// Поручение «на напоминании», если срок наступает в пределах leadHours
// (или уже просрочен) и оно ещё действует.
export function isReminderDue(task, now = new Date()) {
  if (!isActive(task) || !task.deadline) return false;
  const lead = (task.reminder?.leadHours ?? 24) * 3600 * 1000;
  const dl = new Date(task.deadline).getTime();
  return now.getTime() >= dl - lead;
}

export function remindableTasks(tasks, now = new Date()) {
  return tasks.filter((t) => isActive(t) && (t.reminder?.enabled ?? true) && isReminderDue(t, now));
}

// ── Сортировки по категориям ──────────────────────────────────────────────
export function groupOperational(tasks, customObjects = []) {
  const active = tasks.filter((t) => t.category === 'operational' && isActive(t));
  const order = [...OPERATIONAL_OBJECTS, ...customObjects];

  const unknown = [];
  for (const t of active) {
    const obj = t.object || '';
    if (obj && !order.includes(obj) && !unknown.includes(obj)) unknown.push(obj);
  }
  const fullOrder = [...order, ...unknown];

  return fullOrder.map((obj) => ({
    object: obj,
    isCustom: !OPERATIONAL_OBJECTS.includes(obj),
    isUnplaced: unknown.includes(obj),
    tasks: active.filter((t) => (t.object || '') === obj),
  }));
}

export function sortOrgTech(tasks, now = new Date()) {
  const active = tasks.filter((t) => t.category === 'org-tech' && isActive(t));
  return active.slice().sort((a, b) => {
    const ao = isOverdue(a, now), bo = isOverdue(b, now);
    if (ao !== bo) return ao ? -1 : 1;
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    const ap = a.priority ?? 99, bp = b.priority ?? 99;
    return ap - bp;
  });
}

export function groupCommercial(tasks, now = new Date()) {
  const active = tasks.filter((t) => t.category === 'commercial' && isActive(t));

  const groupsMap = new Map();
  for (const t of active) {
    const contractor = (t.contractor || '').trim() || 'Контрагент не указан';
    const contract = (t.contract || '').trim() || 'Договор/проект не указан';
    const key = `${contractor}||${contract}`;
    if (!groupsMap.has(key)) groupsMap.set(key, { contractor, contract, tasks: [] });
    groupsMap.get(key).tasks.push(t);
  }

  const groups = [...groupsMap.values()];
  for (const g of groups) {
    g.tasks.sort((a, b) => {
      if (!!a.financialRisk !== !!b.financialRisk) return a.financialRisk ? -1 : 1;
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd;
    });
  }
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

export function normalizeTask(raw) {
  return {
    id: raw.id || newTaskId(),
    category: raw.category,
    text: (raw.text || '').trim(),

    // исполнители: массив {id, name}
    assignees: Array.isArray(raw.assignees) ? raw.assignees.filter((a) => a && a.id) : [],

    // контролёр
    controllerId: raw.controllerId || null,
    controllerName: raw.controllerName || null,

    // срок
    deadline: raw.deadline || null,

    // перенос срока
    extension: raw.extension || null,

    // отчётность
    reportType: raw.reportType || 'none',
    reportTypeNote: (raw.reportTypeNote || '').trim() || null,
    reports: Array.isArray(raw.reports) ? raw.reports : [],

    // напоминание
    reminder: {
      enabled: raw.reminder?.enabled ?? true,
      leadHours: Number(raw.reminder?.leadHours ?? 24),
    },

    // оперативные
    object: raw.object || null,
    // орг-технические
    priority: raw.priority ?? null,
    // договорно-коммерческие
    contractor: (raw.contractor || '').trim() || null,
    contract: (raw.contract || '').trim() || null,
    financialRisk: !!raw.financialRisk,

    // общие
    note: (raw.note || '').trim() || null,
    status: raw.status === 'closed' ? 'closed' : 'active',
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdById: raw.createdById || null,
    createdByName: raw.createdByName || null,
  };
}

export function validateTask(raw) {
  const errors = [];
  if (!raw.category) errors.push('Не выбрана категория.');
  if (!(raw.text || '').trim()) errors.push('Не заполнена задача.');
  if (raw.category === 'operational' && !(raw.object || '').trim()) {
    errors.push('Для оперативного поручения не выбран объект.');
  }
  if (raw.reportType === 'other' && !(raw.reportTypeNote || '').trim()) {
    errors.push('Уточните вид отчёта («Иное»).');
  }
  return errors;
}
