// app.js — точка входа, состояние и рендеринг интерфейса Mini App (ред. 2).

import {
  CATEGORIES, OPERATIONAL_OBJECTS, REPORT_TYPES, REPORT_TYPE_TITLE, NO_TASKS,
  groupOperational, sortOrgTech, groupCommercial, remindableTasks,
  formatAssignees, formatDeadline, isOverdue,
  isAssignee, isController, isAuthor, hasPendingExtension,
  normalizeTask, validateTask,
} from './model.js';
import { store } from './store.js';
import { buildSummaryText } from './summary.js';
import { Telegram } from './telegram.js';
import { people } from './people.js';

// ── Состояние ──────────────────────────────────────────────────────────────
const state = {
  tasks: [],
  customObjects: [],
  view: 'operational',
  editing: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const now = () => new Date();

// ── Загрузка ────────────────────────────────────────────────────────────────
async function boot() {
  Telegram.init();
  await people.load(Telegram.user());
  state.tasks = await store.loadTasks();
  state.customObjects = await store.loadCustomObjects();
  render();
}

async function persist() {
  await store.saveTasks(state.tasks);
  await store.saveCustomObjects(state.customObjects);
}

function me() { return people.current(); }

// ── Шапка: роль + вкладки ────────────────────────────────────────────────────
function renderHeader() {
  const header = $('#app-header');
  header.innerHTML = '';

  const top = el('div', 'header-top');
  top.appendChild(el('h1', null, 'Поручения'));

  // Переключатель «действую как…» (только для тестирования на одном устройстве).
  const roleWrap = el('div', 'role-switch');
  roleWrap.appendChild(el('span', 'role-label', 'Я:'));
  const sel = el('select', 'role-select');
  for (const m of people.team) {
    sel.appendChild(new Option(m.name, m.id, false, m.id === people.currentId));
  }
  sel.onchange = async () => { await people.setCurrent(sel.value); Telegram.haptic(); render(); };
  roleWrap.appendChild(sel);
  top.appendChild(roleWrap);
  header.appendChild(top);

  // Полоса напоминаний (для действующего лица).
  const due = myRemindable();
  if (due.length) {
    const banner = el('button', 'reminder-banner');
    banner.innerHTML = `🔔 Напоминания: ${due.length} — приближается или истёк срок`;
    banner.onclick = () => { state.view = 'reminders'; render(); };
    header.appendChild(banner);
  }

  // Вкладки.
  const nav = el('nav', 'tabs');
  const tabs = [
    { id: 'operational', label: 'Оперативные' },
    { id: 'org-tech', label: 'Орг.-тех.' },
    { id: 'commercial', label: 'Договорные' },
    { id: 'summary', label: 'Сводка' },
    { id: 'settings', label: '⚙' },
  ];
  for (const t of tabs) {
    const b = el('button', 'tab', t.label);
    if (state.view === t.id) b.classList.add('active');
    b.onclick = () => { state.view = t.id; Telegram.haptic(); render(); };
    nav.appendChild(b);
  }
  header.appendChild(nav);
}

// Поручения, требующие напоминания и касающиеся текущего лица.
function myRemindable() {
  const uid = people.currentId;
  return remindableTasks(state.tasks, now())
    .filter((t) => isAssignee(t, uid) || isController(t, uid) || isAuthor(t, uid));
}

// ── Основной рендер ──────────────────────────────────────────────────────────
function render() {
  renderHeader();
  const root = $('#view');
  root.innerHTML = '';

  switch (state.view) {
    case 'summary':    renderSummary(root); Telegram.showMainButton('Скопировать сводку', copySummary); break;
    case 'settings':   renderSettings(root); Telegram.hideMainButton(); break;
    case 'reminders':  renderReminders(root); Telegram.hideMainButton(); break;
    case 'operational': renderOperational(root); Telegram.showMainButton('+ Поручение', () => openForm('operational')); break;
    case 'org-tech':   renderOrgTech(root); Telegram.showMainButton('+ Поручение', () => openForm('org-tech')); break;
    case 'commercial': renderCommercial(root); Telegram.showMainButton('+ Поручение', () => openForm('commercial')); break;
  }
}

// ── Карточка поручения ───────────────────────────────────────────────────────
function taskCard(t) {
  const uid = people.currentId;
  const card = el('div', 'card');
  if (isOverdue(t)) card.classList.add('overdue');

  card.appendChild(el('div', 'card-text', t.text));

  const meta = el('div', 'card-meta');
  meta.appendChild(metaLine('Исполнитель', formatAssignees(t)));
  meta.appendChild(metaLine('Срок', formatDeadline(t.deadline), isOverdue(t)));
  if (t.controllerName) meta.appendChild(metaLine('Контролёр', t.controllerName));
  if (t.reportType && t.reportType !== 'none') {
    const rt = t.reportType === 'other' ? (t.reportTypeNote || 'иное') : REPORT_TYPE_TITLE[t.reportType];
    meta.appendChild(metaLine('Отчёт', rt));
  }
  card.appendChild(meta);

  if (t.financialRisk) card.appendChild(el('div', 'badge badge-risk', 'Финансовый риск'));

  // Блок переноса срока.
  if (t.extension) card.appendChild(extensionBlock(t));

  // Сданные отчёты (не закрывают поручение).
  if (t.reports?.length) {
    const box = el('div', 'reports');
    box.appendChild(el('div', 'reports-title', `Отчёты (${t.reports.length}) — не является закрытием`));
    for (const r of t.reports) {
      const line = el('div', 'report-line');
      const kind = REPORT_TYPE_TITLE[r.kind] || r.kind;
      line.innerHTML = `<b>${escapeHtml(r.byName)}:</b> ${escapeHtml(r.text || r.fileName || kind)}`;
      box.appendChild(line);
    }
    card.appendChild(box);
  }

  if (t.note) {
    const n = el('div', 'card-note');
    n.innerHTML = `<b>Отметка:</b> ${escapeHtml(t.note)}`;
    card.appendChild(n);
  }

  // Действия зависят от роли действующего лица.
  const actions = el('div', 'card-actions');
  const amAssignee = isAssignee(t, uid);
  const amController = isController(t, uid);
  const amAuthor = isAuthor(t, uid);

  // Исполнитель: запрос переноса и сдача отчёта.
  if (amAssignee) {
    if (!hasPendingExtension(t)) {
      actions.appendChild(actionBtn('Перенос срока', () => openExtensionForm(t)));
    }
    if (t.reportType && t.reportType !== 'none') {
      actions.appendChild(actionBtn('Сдать отчёт', () => openReportForm(t)));
    }
  }

  // Контролёр: согласование переноса.
  if (amController && hasPendingExtension(t)) {
    actions.appendChild(actionBtn('Согласовать перенос', () => decideExtension(t, true), 'btn-ok'));
    actions.appendChild(actionBtn('Вернуть запрос', () => decideExtension(t, false), 'btn-close'));
  }

  // Автор/контролёр: изменение и закрытие.
  if (amAuthor || amController) {
    actions.appendChild(actionBtn('Изменить', () => openForm(t.category, t)));
    actions.appendChild(actionBtn('Закрыть', () => closeTask(t), 'btn-close'));
  }
  if (actions.children.length) card.appendChild(actions);

  return card;
}

function metaLine(label, value, danger = false) {
  const s = el('span', 'meta-item' + (danger ? ' meta-overdue' : ''));
  s.innerHTML = `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;
  return s;
}

function actionBtn(label, onClick, extra = '') {
  const b = el('button', 'btn-small ' + extra, label);
  b.onclick = onClick;
  return b;
}

function extensionBlock(t) {
  const e = t.extension;
  const box = el('div', 'extension ext-' + e.status);
  const statusText = {
    pending: '⏳ Запрос переноса — на согласовании у контролёра',
    approved: '✅ Перенос согласован',
    rejected: '↩️ Запрос переноса возвращён',
  }[e.status];
  box.appendChild(el('div', 'ext-status', statusText));
  box.appendChild(el('div', 'ext-line', `Новый срок: ${formatDeadline(e.requestedDeadline)}`));
  box.appendChild(el('div', 'ext-line', `Причина: ${e.reason}`));
  box.appendChild(el('div', 'ext-line ext-by', `Запросил: ${e.requestedByName}`));
  if (e.decisionComment) box.appendChild(el('div', 'ext-line', `Комментарий контролёра: ${e.decisionComment}`));
  return box;
}

// ── Списки категорий ─────────────────────────────────────────────────────────
function renderOperational(root) {
  for (const g of groupOperational(state.tasks, state.customObjects)) {
    const section = el('div', 'obj-section');
    const head = el('div', 'obj-head');
    head.appendChild(el('span', 'obj-title', g.object));
    if (g.isUnplaced) head.appendChild(el('span', 'badge badge-warn', 'определить место'));
    section.appendChild(head);
    if (g.tasks.length === 0) section.appendChild(el('div', 'empty-line', NO_TASKS));
    else for (const t of g.tasks) section.appendChild(taskCard(t));
    root.appendChild(section);
  }
}

function renderOrgTech(root) {
  const tasks = sortOrgTech(state.tasks);
  if (!tasks.length) return void root.appendChild(el('div', 'empty-line', NO_TASKS));
  for (const t of tasks) root.appendChild(taskCard(t));
}

function renderCommercial(root) {
  const groups = groupCommercial(state.tasks);
  if (!groups.length) return void root.appendChild(el('div', 'empty-line', NO_TASKS));
  for (const g of groups) {
    const section = el('div', 'obj-section');
    const head = el('div', 'obj-head');
    head.appendChild(el('span', 'obj-title', `${g.contractor} / ${g.contract}`));
    section.appendChild(head);
    for (const t of g.tasks) section.appendChild(taskCard(t));
    root.appendChild(section);
  }
}

// ── Напоминания ──────────────────────────────────────────────────────────────
function renderReminders(root) {
  root.appendChild(el('h2', 'view-title', 'Напоминания'));
  root.appendChild(el('p', 'view-hint',
    'Поручения, по которым срок приближается или истёк, — для вас как исполнителя, контролёра или автора. ' +
    'Реальные push-уведомления подключим на сервере (VPS).'));
  const due = myRemindable();
  if (!due.length) return void root.appendChild(el('div', 'empty-line', 'Активных напоминаний нет.'));
  for (const t of due) root.appendChild(taskCard(t));
}

// ── Сводка ───────────────────────────────────────────────────────────────────
function renderSummary(root) {
  const text = buildSummaryText(state.tasks, state.customObjects);
  const pre = el('pre', 'summary');
  pre.textContent = text;
  root.appendChild(pre);
  state._summaryText = text;
}

function copySummary() {
  Telegram.shareText(state._summaryText || buildSummaryText(state.tasks, state.customObjects));
  Telegram.notify('success');
}

// ── Закрытие поручения ───────────────────────────────────────────────────────
async function closeTask(t) {
  const ok = await Telegram.confirm(
    `Закрыть поручение?\n\n«${t.text}»\n\nОтчёт ответственного не является закрытием. ` +
    `Закрывайте только если вопрос снят/закрыт/решён/исполнен.`);
  if (!ok) return;
  t.status = 'closed';
  t.updatedAt = new Date().toISOString();
  await persist();
  Telegram.notify('success');
  render();
}

// ── Перенос срока: запрос исполнителем ───────────────────────────────────────
function openExtensionForm(t) {
  openModal('Запрос переноса срока', (form, errBox) => {
    form.appendChild(field('Новый срок *', dateInput('deadline', t.deadline)));
    form.appendChild(field('Причина переноса * (обязательно)', textarea('reason')));
    return () => {
      const reason = form.reason.value.trim();
      const nd = form.deadline.value;
      if (!nd) return void showErr(errBox, ['Укажите новый срок.']);
      if (!reason) return void showErr(errBox, ['Причина переноса обязательна.']);
      t.extension = {
        requestedDeadline: nd,
        reason,
        requestedById: people.currentId,
        requestedByName: me().name,
        status: 'pending',
        decisionComment: null,
        decidedById: null, decidedByName: null, decidedAt: null,
        createdAt: new Date().toISOString(),
      };
      t.updatedAt = new Date().toISOString();
      return true;
    };
  });
}

// ── Перенос срока: решение контролёра ────────────────────────────────────────
async function decideExtension(t, approve) {
  const verb = approve ? 'Согласовать' : 'Вернуть';
  const comment = await promptText(`${verb} перенос срока. Комментарий (необязательно):`);
  if (comment === null) return; // отмена
  const e = t.extension;
  e.status = approve ? 'approved' : 'rejected';
  e.decisionComment = comment.trim() || null;
  e.decidedById = people.currentId;
  e.decidedByName = me().name;
  e.decidedAt = new Date().toISOString();
  if (approve) t.deadline = e.requestedDeadline; // применяем новый срок
  t.updatedAt = new Date().toISOString();
  await persist();
  Telegram.notify('success');
  render();
}

// ── Сдача отчёта (не закрывает поручение) ────────────────────────────────────
function openReportForm(t) {
  openModal('Отчёт об исполнении', (form, errBox) => {
    const kind = t.reportType;
    form.appendChild(el('div', 'form-note',
      `Требуемый вид отчёта: ${kind === 'other' ? (t.reportTypeNote || 'иное') : REPORT_TYPE_TITLE[kind]}. ` +
      `Отчёт не закрывает поручение — закрытие выполняет автор/контролёр.`));
    if (kind === 'text' || kind === 'other') {
      form.appendChild(field('Текст отчёта', textarea('text')));
    }
    if (kind === 'file' || kind === 'photo') {
      form.appendChild(field(kind === 'photo' ? 'Фото' : 'Файл', fileInput('file')));
      form.appendChild(field('Комментарий', textarea('text')));
    }
    return () => {
      const text = form.text?.value.trim() || '';
      const fileName = form.file?.files?.[0]?.name || null;
      if (!text && !fileName) return void showErr(errBox, ['Заполните отчёт (текст или файл).']);
      t.reports = t.reports || [];
      t.reports.push({
        id: 'r' + Date.now().toString(36),
        byId: people.currentId, byName: me().name,
        at: new Date().toISOString(),
        kind, text: text || null, fileName,
      });
      t.updatedAt = new Date().toISOString();
      return true;
    };
  });
}

// ── Форма создания/редактирования поручения ──────────────────────────────────
function openForm(category, task = null) {
  state.editing = task;
  openModal(task ? 'Изменить поручение' : 'Новое поручение', (form, errBox) => {
    form.appendChild(field('Задача *', textarea('text', task?.text)));

    if (category === 'operational') form.appendChild(field('Объект *', objectSelect(task?.object)));
    if (category === 'commercial') {
      form.appendChild(field('Контрагент', input('contractor', task?.contractor)));
      form.appendChild(field('Договор / проект', input('contract', task?.contract)));
      form.appendChild(checkbox('financialRisk', 'Финансовый риск (штрафы, удержания)', task?.financialRisk));
    }

    // Исполнители (индивидуально или «поровну» на двоих и более).
    form.appendChild(field('Исполнители (индивидуально или поровну)', assigneesBox(task?.assignees)));
    // Контролёр.
    form.appendChild(field('Контролёр', controllerSelect(task?.controllerId)));
    // Срок.
    form.appendChild(field('Срок исполнения', dateInput('deadline', task?.deadline)));

    if (category === 'org-tech') form.appendChild(field('Приоритет (1 — выше)', numberInput('priority', task?.priority)));

    // Вид отчёта.
    form.appendChild(field('Вид отчёта об исполнении', reportTypeSelect(task?.reportType)));
    form.appendChild(field('Уточнение вида отчёта (для «Иное»)', input('reportTypeNote', task?.reportTypeNote)));

    // Напоминание.
    form.appendChild(checkbox('reminderEnabled', 'Напоминать о приближении срока', task?.reminder?.enabled ?? true));
    form.appendChild(field('За сколько часов напоминать', numberInput('reminderLead', task?.reminder?.leadHours ?? 24)));

    form.appendChild(field('Отметка / комментарий', textarea('note', task?.note)));

    return () => submitTaskForm(category, form, errBox);
  });
}

function submitTaskForm(category, form, errBox) {
  // Собираем выбранных исполнителей.
  const assignees = [];
  form.querySelectorAll('input[name="assignee"]:checked').forEach((cb) => {
    assignees.push({ id: cb.value, name: people.name(cb.value) });
  });
  const controllerId = form.controllerId?.value || null;

  const data = {
    id: state.editing?.id,
    createdAt: state.editing?.createdAt,
    status: state.editing?.status,
    createdById: state.editing?.createdById || people.currentId,
    createdByName: state.editing?.createdByName || me().name,
    extension: state.editing?.extension || null,
    reports: state.editing?.reports || [],
    category,
    text: form.text.value,
    assignees,
    controllerId,
    controllerName: controllerId ? people.name(controllerId) : null,
    deadline: form.deadline?.value || null,
    object: form.object?.value,
    contractor: form.contractor?.value,
    contract: form.contract?.value,
    financialRisk: form.financialRisk?.checked,
    priority: form.priority?.value ? Number(form.priority.value) : null,
    reportType: form.reportType?.value || 'none',
    reportTypeNote: form.reportTypeNote?.value,
    reminder: {
      enabled: form.reminderEnabled?.checked ?? true,
      leadHours: form.reminderLead?.value ? Number(form.reminderLead.value) : 24,
    },
    note: form.note?.value,
  };

  const errors = validateTask(data);
  if (errors.length) { showErr(errBox, errors); return false; }

  const normalized = normalizeTask(data);

  // Правило 4: новый оперативный объект вне перечня.
  if (category === 'operational' && normalized.object) {
    const known = [...OPERATIONAL_OBJECTS, ...state.customObjects];
    if (!known.includes(normalized.object)) {
      state.customObjects.push(normalized.object);
      Telegram.alert(
        `Объект «${normalized.object}» отсутствует в штатном перечне. ` +
        `Он добавлен в конец раздела. Определите его постоянное место в очередности.`);
    }
  }

  if (state.editing) {
    const idx = state.tasks.findIndex((t) => t.id === state.editing.id);
    state.tasks[idx] = normalized;
  } else {
    state.tasks.push(normalized);
  }
  return true; // openModal сам сохранит и перерисует
}

// ── Настройки: команда ───────────────────────────────────────────────────────
function renderSettings(root) {
  root.appendChild(el('h2', 'view-title', 'Команда'));
  root.appendChild(el('p', 'view-hint',
    'Участники, между которыми распределяются поручения и назначается контролёр. ' +
    'Переключатель «Я» вверху имитирует вход разных пользователей — это для теста на одном устройстве.'));

  const list = el('div', 'team-list');
  for (const m of people.team) {
    const row = el('div', 'team-row');
    row.appendChild(el('span', 'team-name', m.name));
    const rn = actionBtn('Переименовать', async () => {
      const name = await promptText('Новое имя:', m.name);
      if (name && name.trim()) { await people.rename(m.id, name); render(); }
    });
    const rm = actionBtn('Удалить', async () => {
      if (people.team.length <= 1) return void Telegram.alert('Нужен хотя бы один участник.');
      if (await Telegram.confirm(`Удалить участника «${m.name}»?`)) { await people.remove(m.id); render(); }
    }, 'btn-close');
    const acts = el('div', 'team-actions');
    acts.append(rn, rm);
    row.appendChild(acts);
    list.appendChild(row);
  }
  root.appendChild(list);

  const add = el('button', 'btn btn-primary', '+ Добавить участника');
  add.onclick = async () => {
    const name = await promptText('Имя нового участника:');
    if (name && name.trim()) { await people.add(name); render(); }
  };
  root.appendChild(add);
}

// ── Общая модалка ────────────────────────────────────────────────────────────
// builder(form, errBox) → onSubmit(). onSubmit возвращает true при успехе.
function openModal(title, builder) {
  const overlay = $('#overlay');
  overlay.innerHTML = '';
  overlay.classList.add('open');
  const modal = el('div', 'modal');
  modal.appendChild(el('div', 'modal-title', title));

  const form = el('form', 'form');
  const errBox = el('div', 'form-errors');
  const onSubmit = builder(form, errBox);
  form.appendChild(errBox);

  const buttons = el('div', 'form-buttons');
  const cancel = el('button', 'btn btn-secondary', 'Отмена');
  cancel.type = 'button';
  cancel.onclick = closeModal;
  const save = el('button', 'btn btn-primary', 'Сохранить');
  save.type = 'submit';
  buttons.append(cancel, save);
  form.appendChild(buttons);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const ok = onSubmit();
    if (ok === false) { Telegram.notify('error'); return; }
    await persist();
    Telegram.notify('success');
    closeModal();
  };

  modal.appendChild(form);
  overlay.appendChild(modal);
  Telegram.hideMainButton();
  Telegram.showBackButton(closeModal);
}

function closeModal() {
  $('#overlay').classList.remove('open');
  $('#overlay').innerHTML = '';
  state.editing = null;
  Telegram.hideBackButton();
  render();
}

// ── Хелперы полей формы ──────────────────────────────────────────────────────
function field(label, control) {
  const wrap = el('label', 'form-field');
  wrap.appendChild(el('span', 'form-label', label));
  wrap.appendChild(control);
  return wrap;
}
function input(name, value, placeholder) {
  const i = el('input', 'form-input');
  i.type = 'text'; i.name = name;
  if (value) i.value = value;
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function numberInput(name, value) {
  const i = el('input', 'form-input');
  i.type = 'number'; i.min = '0'; i.name = name;
  if (value != null) i.value = value;
  return i;
}
function dateInput(name, value) {
  const i = el('input', 'form-input');
  i.type = 'datetime-local'; i.name = name;
  if (value) i.value = value.slice(0, 16);
  return i;
}
function textarea(name, value) {
  const t = el('textarea', 'form-input');
  t.name = name; t.rows = 2;
  if (value) t.value = value;
  return t;
}
function fileInput(name) {
  const i = el('input', 'form-input');
  i.type = 'file'; i.name = name;
  return i;
}
function checkbox(name, label, checked) {
  const wrap = el('label', 'form-checkbox');
  const c = el('input');
  c.type = 'checkbox'; c.name = name; c.checked = !!checked;
  wrap.appendChild(c);
  wrap.appendChild(el('span', null, label));
  return wrap;
}
function assigneesBox(selected = []) {
  const box = el('div', 'assignees-box');
  const sel = new Set((selected || []).map((a) => a.id));
  for (const m of people.team) {
    const wrap = el('label', 'form-checkbox');
    const c = el('input');
    c.type = 'checkbox'; c.name = 'assignee'; c.value = m.id; c.checked = sel.has(m.id);
    wrap.appendChild(c);
    wrap.appendChild(el('span', null, m.name));
    box.appendChild(wrap);
  }
  box.appendChild(el('div', 'form-note', 'Один — индивидуально; двое и более — поровну.'));
  return box;
}
function controllerSelect(value) {
  const s = el('select', 'form-input');
  s.name = 'controllerId';
  s.appendChild(new Option('— не назначен —', ''));
  for (const m of people.team) s.appendChild(new Option(m.name, m.id, false, m.id === value));
  return s;
}
function reportTypeSelect(value) {
  const s = el('select', 'form-input');
  s.name = 'reportType';
  for (const r of REPORT_TYPES) s.appendChild(new Option(r.title, r.id, false, r.id === (value || 'none')));
  return s;
}
function objectSelect(value) {
  const s = el('select', 'form-input');
  s.name = 'object';
  s.appendChild(new Option('— выберите объект —', ''));
  for (const o of [...OPERATIONAL_OBJECTS, ...state.customObjects]) {
    s.appendChild(new Option(o, o, false, o === value));
  }
  const custom = new Option('+ другой объект…', '__custom__');
  s.appendChild(custom);
  s.onchange = async () => {
    if (s.value === '__custom__') {
      const name = await promptText('Наименование нового объекта (воспроизводится без изменений):');
      if (name && name.trim()) {
        const opt = new Option(name.trim(), name.trim(), true, true);
        s.insertBefore(opt, custom);
        s.value = name.trim();
      } else s.value = '';
    }
  };
  return s;
}

function showErr(errBox, errors) {
  errBox.innerHTML = errors.map((e) => `<div>• ${escapeHtml(e)}</div>`).join('');
}

// Ввод текста: нативный Telegram-попап при наличии, иначе window.prompt.
function promptText(message, def = '') {
  return new Promise((resolve) => {
    // Telegram не имеет prompt с текстовым вводом → используем window.prompt.
    const v = window.prompt(message, def);
    resolve(v);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

boot();
