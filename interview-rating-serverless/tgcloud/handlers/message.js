import { api } from 'sdk';
import { DECISIONS } from '../lib/config.js';
import {
  aggregate, appLink, createCandidate, deleteCandidate, displayName, getCandidate, getVotes,
  isAdmin, listCandidates, setResume, canUploadResume, resumeExtension,
} from '../lib/rating.js';

// Управление через чат с ботом: создание кандидатов, ссылки для Express, итоги, резюме.

const HELP = `<b>Оценка кандидатов</b>

/new ФИО; Должность — добавить кандидата и получить ссылку для Express
/list — все кандидаты и ссылки
/results &lt;код&gt; — итоги оценки
/resume &lt;код&gt; — отправьте документ с такой подписью, чтобы прикрепить резюме
/delete &lt;код&gt; — удалить кандидата
/myid — ваш Telegram ID`;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function reply(message, text, extra = {}) {
  return api.sendMessage({
    chat_id: message.chat.id,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

function openButton(url) {
  return { reply_markup: { inline_keyboard: [[{ text: 'Открыть оценку', url }]] } };
}

async function results(message, id) {
  const c = await getCandidate(id);
  if (!c) return reply(message, 'Кандидат не найден. Код можно посмотреть в /list');
  const votes = await getVotes(c.id);
  const r = aggregate(votes);
  const lines = [
    `<b>${esc(c.name)}</b>${c.position ? ' — ' + esc(c.position) : ''}`,
    `Оценок: ${r.count}, средний балл: ${r.average ?? '—'}`,
    ...Object.keys(DECISIONS).map((k) => `${DECISIONS[k]}: ${r.decisions[k]}`),
  ];
  if (r.count) lines.push(r.leader ? `Большинство: <b>${DECISIONS[r.leader]}</b>` : 'Единого мнения нет');
  if (votes.length) lines.push('');
  lines.push(
    ...votes.map((v) => `• ${esc(v.name)}: ${v.score} — ${DECISIONS[v.decision]}${v.comment ? ` («${esc(v.comment)}»)` : ''}`),
  );
  return reply(message, lines.join('\n'), openButton(await appLink(c.id)));
}

export default async function (message) {
  const text = (message.text || message.caption || '').trim();
  const from = message.from;
  if (!from || message.chat.type !== 'private') return;

  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const cmd = m ? m[1].toLowerCase() : '';
  const arg = m && m[2] ? m[2].trim() : '';

  if (cmd === 'myid') return reply(message, `Ваш Telegram ID: <code>${from.id}</code>`);

  if (cmd === 'start' && arg) {
    const c = await getCandidate(arg);
    if (c) return reply(message, `Оценка кандидата: <b>${esc(c.name)}</b>`, openButton(await appLink(c.id)));
  }

  // Документ с подписью /resume <код> (или ответ этой командой на сообщение с документом).
  if (cmd === 'resume') {
    const doc = message.document || (message.reply_to_message && message.reply_to_message.document);
    if (!canUploadResume(from.id)) return reply(message, 'Загрузка резюме вам недоступна.');
    if (!doc) return reply(message, 'Отправьте файл резюме как документ с подписью <code>/resume код</code>.');
    const c = await getCandidate(arg);
    if (!c) return reply(message, 'Кандидат не найден. Код можно посмотреть в /list');
    if (!resumeExtension(doc.file_name)) return reply(message, 'Этот формат не поддерживается. Пришлите PDF, DOC(X), RTF, ODT, TXT, JPG или PNG.');
    await setResume(c.id, {
      fileId: doc.file_id,
      fileName: doc.file_name,
      size: doc.file_size,
      uploadedBy: displayName(from),
    });
    return reply(message, `Резюме прикреплено: <b>${esc(c.name)}</b>`);
  }

  if (!isAdmin(from.id)) {
    return reply(message, 'Откройте ссылку на оценку кандидата, которую вам прислали.\nВаш Telegram ID: <code>' + from.id + '</code>');
  }

  switch (cmd) {
    case 'new': {
      const [name, position = ''] = arg.split(/\s*[;|\n]\s*/);
      if (!name) return reply(message, 'Формат: <code>/new Иванов Иван; Ведущий аналитик</code>');
      const c = await createCandidate({ name: name.slice(0, 200), position: position.slice(0, 200), createdBy: from.id });
      const link = await appLink(c.id);
      return reply(
        message,
        `Кандидат добавлен: <b>${esc(c.name)}</b>${c.position ? ' — ' + esc(c.position) : ''}\n` +
          `Код: <code>${c.id}</code>\n\nСсылка для Express:\n${link}\n\n` +
          `Резюме: отправьте файл документом с подписью <code>/resume ${c.id}</code> или загрузите в приложении.`,
        openButton(link),
      );
    }
    case 'list': {
      const list = await listCandidates();
      if (!list.length) return reply(message, 'Кандидатов пока нет. Добавьте: <code>/new ФИО; Должность</code>');
      const lines = [];
      for (const c of list.slice(0, 30)) {
        lines.push(`<b>${esc(c.name)}</b>${c.position ? ' — ' + esc(c.position) : ''}\n` +
          `код <code>${c.id}</code>, оценок: ${c.votes_count}${c.resume_file_id ? ', есть резюме' : ''}\n${await appLink(c.id)}`);
      }
      return reply(message, lines.join('\n\n'));
    }
    case 'results':
      return results(message, arg);
    case 'delete': {
      const c = await getCandidate(arg);
      if (!c) return reply(message, 'Кандидат не найден.');
      await deleteCandidate(c.id);
      return reply(message, `Удалено: ${esc(c.name)}`);
    }
    default:
      return reply(message, HELP);
  }
}
