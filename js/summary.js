// summary.js — генерация полной сводки строго по шаблону регламента.

import {
  CATEGORY_TITLE, NO_TASKS,
  groupOperational, sortOrgTech, groupCommercial,
  formatResponsible, formatDeadline,
} from './model.js';

// Один пункт поручения в текстовом виде.
function renderTaskLine(t) {
  const lines = [`- ${t.text}`];
  lines.push(`  Ответственный: ${formatResponsible(t.responsible)}`);
  lines.push(`  Срок: ${formatDeadline(t.deadline)}`);
  return lines.join('\n');
}

// Полная сводка как обычный текст (для копирования / отправки в чат).
export function buildSummaryText(tasks, customObjects = [], now = new Date()) {
  const out = [];

  // ── ОПЕРАТИВНЫЕ ──
  out.push('ОПЕРАТИВНЫЕ');
  out.push('');
  const opGroups = groupOperational(tasks, customObjects);
  for (const g of opGroups) {
    out.push(g.object);
    if (g.tasks.length === 0) {
      out.push(`- ${NO_TASKS}`);
    } else {
      for (const t of g.tasks) out.push(renderTaskLine(t));
    }
    out.push('');
  }

  // ── ОРГАНИЗАЦИОННО-ТЕХНИЧЕСКИЕ ──
  out.push('ОРГАНИЗАЦИОННО-ТЕХНИЧЕСКИЕ');
  out.push('');
  const orgTasks = sortOrgTech(tasks, now);
  if (orgTasks.length === 0) {
    out.push(`- ${NO_TASKS}`);
    out.push('');
  } else {
    for (const t of orgTasks) {
      out.push(renderTaskLine(t));
    }
    out.push('');
  }

  // ── ДОГОВОРНО-КОММЕРЧЕСКИЕ ──
  out.push('ДОГОВОРНО-КОММЕРЧЕСКИЕ');
  out.push('');
  const comGroups = groupCommercial(tasks, now);
  if (comGroups.length === 0) {
    out.push(`- ${NO_TASKS}`);
  } else {
    for (const g of comGroups) {
      out.push(`${g.contractor} / ${g.contract}`);
      for (const t of g.tasks) out.push(renderTaskLine(t));
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
