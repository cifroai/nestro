#!/usr/bin/env node
'use strict';

// Управление кандидатами и получение ссылки для рассылки в Express.
//
//   node scripts/candidates.js add "Иванов Иван" "Ведущий аналитик"
//   node scripts/candidates.js list
//   node scripts/candidates.js results <id>
//   node scripts/candidates.js remove <id>
//
// Для формирования ссылки нужны BOT_USERNAME и APP_SHORT_NAME (имя Mini App из @BotFather).

const path = require('path');
const store = require(path.join(__dirname, '..', 'store'));

const BOT_USERNAME = (process.env.BOT_USERNAME || '').replace(/^@/, '');
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || '';
const LABELS = { accept: 'Принять', reject: 'Отклонить', reserve: 'В резерв' };

function link(id) {
  if (!BOT_USERNAME || !APP_SHORT_NAME) {
    return `(задайте BOT_USERNAME и APP_SHORT_NAME) https://t.me/<бот>/<app>?startapp=${id}`;
  }
  return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=${id}`;
}

function results(c) {
  const votes = Object.values(c.votes);
  const avg = votes.length ? (votes.reduce((s, v) => s + v.score, 0) / votes.length).toFixed(2) : '—';
  const counts = { accept: 0, reject: 0, reserve: 0 };
  for (const v of votes) counts[v.decision]++;
  console.log(`${c.name}${c.position ? ' — ' + c.position : ''}`);
  console.log(`Оценок: ${votes.length}, средний балл: ${avg}`);
  for (const k of Object.keys(counts)) console.log(`  ${LABELS[k]}: ${counts[k]}`);
  for (const v of votes) {
    console.log(`  • ${v.name}: ${v.score} — ${LABELS[v.decision]}${v.comment ? ' («' + v.comment + '»)' : ''}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'add': {
    const [name, position] = args;
    if (!name) {
      console.error('Использование: add "ФИО кандидата" ["Должность"]');
      process.exit(1);
    }
    const c = store.addCandidate({ name, position });
    console.log(`Кандидат добавлен: ${c.name} (id: ${c.id})`);
    console.log(`Ссылка для Express: ${link(c.id)}`);
    break;
  }
  case 'list':
    for (const c of store.listCandidates()) {
      console.log(`${c.id}\t${c.name}\t${c.position}\tоценок: ${Object.keys(c.votes).length}\t${link(c.id)}`);
    }
    break;
  case 'results': {
    const c = store.getCandidate(args[0]);
    if (!c) {
      console.error('Кандидат не найден');
      process.exit(1);
    }
    results(c);
    break;
  }
  case 'remove':
    console.log(store.removeCandidate(args[0]) ? 'Удалено' : 'Кандидат не найден');
    break;
  default:
    console.log('Команды: add "ФИО" ["Должность"] | list | results <id> | remove <id>');
}
