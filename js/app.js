// app.js — точка входа, состояние и рендеринг интерфейса Mini App.

import {
  CATEGORIES, CATEGORY_TITLE, OPERATIONAL_OBJECTS, NO_TASKS,
  groupOperational, sortOrgTech, groupCommercial,
  formatResponsible, formatDeadline, isOverdue,
  normalizeTask, validateTask, newTaskId,
} from './model.js';
import { store } from './store.js';
import { buildSummaryText } from './summary.js';
import { Telegram } from './telegram.js';

// ── Состояние ──────────────────────────────────────────────────────────────
const state = {
  tasks: [],
  customObjects: [],
  view: 'operational',   // operational | org-tech | commercial | summary
  editing: null,         // редактируемое поручение или null
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ── Загрузка ────────────────────────────────────────────────────────────────
async function boot() {
  Telegram.init();
  state.tasks = await store.loadTasks();
  state.customObjects = await store.loadCustomObjects();
  renderTabs();
  render();
}

async function persist() {
  await store.saveTasks(state.tasks);
  await store.saveCustomObjects(state.customObjects);
}

// ── Навигация ────────────────────────────────────────────────────────────────
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  const tabs = [
    ...CATEGORIES.map((c) => ({ id: c.id, label: shortLabel(c.id) })),
    { id: 'summary', label: 'Сводка' },
  ];
  for (const t of tabs) {
    const b = el('button', 'tab', t.label);
    b.dataset.view = t.id;
    if (state.view === t.id) b.classList.add('active');
    b.onclick = () => { state.view = t.id; Telegram.haptic(); render(); };
    nav.appendChild(b);
  }
}

function shortLabel(id) {
  return { operational: 'Оперативные', 'org-tech': 'Орг.-тех.', commercial: 'Договорные' }[id];
}

// ── Основной рендер ──────────────────────────────────────────────────────────
function render() {
  renderTabs();
  const root = $('#view');
  root.innerHTML = '';

  if (state.view === 'summary') {
    renderSummary(root);
    Telegram.showMainButton('Скопировать сводку', copySummary);
  } else if (state.view === 'operational') {
    renderOperational(root);
    Telegram.showMainButton('+ Поручение', () => openForm('operational'));
  } else if (state.view === 'org-tech') {
    renderOrgTech(root);
    Telegram.showMainButton('+ Поручение', () => openForm('org-tech'));
  } else if (state.view === 'commercial') {
    renderCommercial(root);
    Telegram.showMainButton('+ Поручение', () => openForm('commercial'));
  }
}

// ── Карточка поручения ───────────────────────────────────────────────────────
function taskCard(t) {
  const card = el('div', 'card');
  if (isOverdue(t)) card.classList.add('overdue');

  const text = el('div', 'card-text', t.text);
  card.appendChild(text);

  const meta = el('div', 'card-meta');
  const resp = el('span', 'meta-item');
  resp.innerHTML = `<b>Ответственный:</b> ${escapeHtml(formatResponsible(t.responsible))}`;
  const dl = el('span', 'meta-item' + (isOverdue(t) ? ' meta-overdue' : ''));
  dl.innerHTML = `<b>Срок:</b> ${escapeHtml(formatDeadline(t.deadline))}`;
  meta.append(resp, dl);
  card.appendChild(meta);

  if (t.financialRisk) {
    card.appendChild(el('div', 'badge badge-risk', 'Финансовый риск'));
  }
  if (t.note) {
    const note = el('div', 'card-note');
    note.innerHTML = `<b>Отметка:</b> ${escapeHtml(t.note)}`;
    card.appendChild(note);
  }

  const actions = el('div', 'card-actions');
  const edit = el('button', 'btn-small', 'Изменить');
  edit.onclick = () => openForm(t.category, t);
  const close = el('button', 'btn-small btn-close', 'Закрыть');
  close.onclick = () => closeTask(t);
  actions.append(edit, close);
  card.appendChild(actions);

  return card;
}

// ── Оперативные ──────────────────────────────────────────────────────────────
function renderOperational(root) {
  const groups = groupOperational(state.tasks, state.customObjects);
  for (const g of groups) {
    const section = el('div', 'obj-section');
    const head = el('div', 'obj-head');
    head.appendChild(el('span', 'obj-title', g.object));
    if (g.isUnplaced) {
      head.appendChild(el('span', 'badge badge-warn', 'определить место'));
    }
    section.appendChild(head);

    if (g.tasks.length === 0) {
      section.appendChild(el('div', 'empty-line', NO_TASKS));
    } else {
      for (const t of g.tasks) section.appendChild(taskCard(t));
    }
    root.appendChild(section);
  }
}

// ── Организационно-технические ───────────────────────────────────────────────
function renderOrgTech(root) {
  const tasks = sortOrgTech(state.tasks);
  if (tasks.length === 0) {
    root.appendChild(el('div', 'empty-line', NO_TASKS));
    return;
  }
  for (const t of tasks) root.appendChild(taskCard(t));
}

// ── Договорно-коммерческие ───────────────────────────────────────────────────
function renderCommercial(root) {
  const groups = groupCommercial(state.tasks);
  if (groups.length === 0) {
    root.appendChild(el('div', 'empty-line', NO_TASKS));
    return;
  }
  for (const g of groups) {
    const section = el('div', 'obj-section');
    const head = el('div', 'obj-head');
    head.appendChild(el('span', 'obj-title', `${g.contractor} / ${g.contract}`));
    section.appendChild(head);
    for (const t of g.tasks) section.appendChild(taskCard(t));
    root.appendChild(section);
  }
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

// ── Закрытие поручения (только по явному действию пользователя) ──────────────
async function closeTask(t) {
  const ok = await Telegram.confirm(
    `Закрыть поручение?\n\n«${t.text}»\n\nОтчёт ответственного не является закрытием. ` +
    `Закрывайте только если вопрос снят/закрыт/решён/исполнен.`,
  );
  if (!ok) return;
  t.status = 'closed';
  t.updatedAt = new Date().toISOString();
  await persist();
  Telegram.notify('success');
  render();
}

// ── Форма создания/редактирования ────────────────────────────────────────────
function openForm(category, task = null) {
  state.editing = task;
  const overlay = $('#overlay');
  overlay.innerHTML = '';
  overlay.classList.add('open');

  const modal = el('div', 'modal');
  modal.appendChild(el('div', 'modal-title', task ? 'Изменить поручение' : 'Новое поручение'));

  const form = el('form', 'form');
  form.appendChild(field('Задача *', textarea('text', task?.text)));

  // Поля, специфичные для категории.
  if (category === 'operational') {
    form.appendChild(field('Объект *', objectSelect(task?.object)));
  }
  if (category === 'commercial') {
    form.appendChild(field('Контрагент', input('contractor', task?.contractor)));
    form.appendChild(field('Договор / проект', input('contract', task?.contract)));
    form.appendChild(checkbox('financialRisk', 'Есть финансовый риск (штрафы, удержания)', task?.financialRisk));
  }

  form.appendChild(field('Ответственный', input('responsible', task?.responsible, 'оставьте пустым — «не определен»')));
  form.appendChild(field('Срок исполнения', dateInput('deadline', task?.deadline)));

  if (category === 'org-tech') {
    form.appendChild(field('Приоритет (1 — выше)', numberInput('priority', task?.priority)));
  }

  form.appendChild(field('Отметка / отчёт (не закрывает поручение)', textarea('note', task?.note)));

  const errBox = el('div', 'form-errors');
  form.appendChild(errBox);

  const buttons = el('div', 'form-buttons');
  const cancel = el('button', 'btn btn-secondary', 'Отмена');
  cancel.type = 'button';
  cancel.onclick = closeForm;
  const save = el('button', 'btn btn-primary', 'Сохранить');
  save.type = 'submit';
  buttons.append(cancel, save);
  form.appendChild(buttons);

  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(category, form, errBox);
  };

  modal.appendChild(form);
  overlay.appendChild(modal);
  Telegram.hideMainButton();
  Telegram.showBackButton(closeForm);
}

function closeForm() {
  $('#overlay').classList.remove('open');
  $('#overlay').innerHTML = '';
  state.editing = null;
  Telegram.hideBackButton();
  render();
}

async function submitForm(category, form, errBox) {
  const data = {
    id: state.editing?.id,
    createdAt: state.editing?.createdAt,
    status: state.editing?.status,
    category,
    text: form.text.value,
    responsible: form.responsible?.value,
    deadline: form.deadline?.value || null,
    object: form.object?.value,
    contractor: form.contractor?.value,
    contract: form.contract?.value,
    financialRisk: form.financialRisk?.checked,
    priority: form.priority?.value ? Number(form.priority.value) : null,
    note: form.note?.value,
  };

  const errors = validateTask(data);
  if (errors.length) {
    errBox.innerHTML = errors.map((e) => `<div>• ${escapeHtml(e)}</div>`).join('');
    Telegram.notify('error');
    return;
  }

  const normalized = normalizeTask(data);

  // Правило 4: новый оперативный объект вне перечня — добавить и предупредить.
  if (category === 'operational' && normalized.object) {
    const known = [...OPERATIONAL_OBJECTS, ...state.customObjects];
    if (!known.includes(normalized.object)) {
      state.customObjects.push(normalized.object);
      Telegram.alert(
        `Объект «${normalized.object}» отсутствует в штатном перечне. ` +
        `Он добавлен в конец раздела. Определите его постоянное место в очередности.`,
      );
    }
  }

  if (state.editing) {
    const idx = state.tasks.findIndex((t) => t.id === state.editing.id);
    state.tasks[idx] = normalized;
  } else {
    state.tasks.push(normalized);
  }

  await persist();
  Telegram.notify('success');
  closeForm();
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
  i.type = 'text';
  i.name = name;
  if (value) i.value = value;
  if (placeholder) i.placeholder = placeholder;
  return i;
}

function numberInput(name, value) {
  const i = el('input', 'form-input');
  i.type = 'number';
  i.min = '1';
  i.name = name;
  if (value != null) i.value = value;
  return i;
}

function dateInput(name, value) {
  const i = el('input', 'form-input');
  i.type = 'datetime-local';
  i.name = name;
  if (value) i.value = value.slice(0, 16);
  return i;
}

function textarea(name, value) {
  const t = el('textarea', 'form-input');
  t.name = name;
  t.rows = 2;
  if (value) t.value = value;
  return t;
}

function objectSelect(value) {
  const s = el('select', 'form-input');
  s.name = 'object';
  const opts = [...OPERATIONAL_OBJECTS, ...state.customObjects];
  s.appendChild(new Option('— выберите объект —', ''));
  for (const o of opts) s.appendChild(new Option(o, o, false, o === value));
  // Возможность ввести новый объект.
  const custom = new Option('+ другой объект…', '__custom__');
  s.appendChild(custom);
  s.onchange = () => {
    if (s.value === '__custom__') {
      const name = prompt('Наименование нового объекта (воспроизводится без изменений):');
      if (name && name.trim()) {
        const opt = new Option(name.trim(), name.trim(), true, true);
        s.insertBefore(opt, custom);
        s.value = name.trim();
      } else {
        s.value = '';
      }
    }
  };
  return s;
}

function checkbox(name, label, checked) {
  const wrap = el('label', 'form-checkbox');
  const c = el('input');
  c.type = 'checkbox';
  c.name = name;
  c.checked = !!checked;
  wrap.appendChild(c);
  wrap.appendChild(el('span', null, label));
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

boot();
