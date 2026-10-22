// Локальные тесты логики на заглушках SDK: node --experimental-sqlite test/run.js
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./hooks.js', import.meta.url);

const { db, calls, blockedUsers, EndpointError } = await import('./sdk/index.js');
const { ddl } = await import('./sdk/db.js');
await import('../tgcloud/schema.js');
for (const s of ddl()) db._exec(s);

const ep = async (name, input, user) => (await import(`../tgcloud/endpoints/${name}.js`)).default(input, { initData: { user } });
const handler = (await import('../tgcloud/handlers/message.js')).default;
const msg = (from, text, extra = {}) => handler({ chat: { id: from.id, type: 'private' }, from, text, ...extra });
const lastText = () => [...calls].reverse().find((c) => c.method === 'sendMessage').params.text;
const rejects = async (p, code) => {
  try { await p; } catch (e) { assert.ok(e instanceof EndpointError, e); assert.equal(e.parameters.code, code); return; }
  assert.fail('expected EndpointError ' + code);
};

const hr = { id: 100, first_name: 'Ольга', last_name: 'HR' };
const anna = { id: 200, first_name: 'Анна' };
const oleg = { id: 5000000000, first_name: 'Олег', username: 'oleg' };

// Создание кандидата через бота
await msg(hr, '/new Иванов Иван; Ведущий аналитик');
const id = /startapp=([A-Za-z0-9]+)/.exec(lastText())[1];
assert.match(lastText(), /https:\/\/t\.me\/nestro_hr_bot\/rate\?startapp=/);

// До голосования результаты скрыты
let s = await ep('getCandidate', { id }, anna);
assert.equal(s.name, 'Иванов Иван');
assert.equal(s.results, null);
assert.equal(s.bot, 'nestro_hr_bot');
await rejects(ep('getCandidate', { id: 'nope' }, anna), 'NOT_FOUND');

// Валидация
await rejects(ep('vote', { id, score: 11, decision: 'accept' }, anna), 'INVALID_VOTE');
await rejects(ep('vote', { id, score: 5, decision: 'maybe' }, anna), 'INVALID_VOTE');
await rejects(ep('vote', { id, score: 5, decision: '__proto__' }, anna), 'INVALID_VOTE');

// Голосование и повторное голосование
s = await ep('vote', { id, score: 9, decision: 'accept', comment: 'Сильный' }, anna);
assert.equal(s.results.count, 1);
s = await ep('vote', { id, score: 4, decision: 'reject' }, oleg);
assert.equal(s.results.count, 2);
assert.equal(s.results.leader, null);
s = await ep('vote', { id, score: 8, decision: 'reject', comment: 'Передумала' }, anna);
assert.equal(s.results.count, 2, 'повторная оценка заменяет прежнюю');
assert.equal(s.results.average, 6);
assert.equal(s.results.leader, 'reject');
assert.deepEqual(s.myVote, { score: 8, decision: 'reject', comment: 'Передумала' });

// Резюме из Mini App
const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
await rejects(ep('uploadResume', { id, fileName: 'a.exe', data: pdf }, anna), 'BAD_TYPE');
await rejects(ep('uploadResume', { id, fileName: 'a.pdf', data: '' }, anna), 'BAD_FILE');
blockedUsers.add(anna.id);
await rejects(ep('uploadResume', { id, fileName: 'a.pdf', data: pdf }, anna), 'NO_WRITE_ACCESS');
blockedUsers.delete(anna.id);
s = await ep('uploadResume', { id, fileName: 'Резюме Иванов.pdf', data: pdf }, anna);
assert.equal(s.resume.fileName, 'Резюме Иванов.pdf');
assert.equal(s.resume.uploadedBy, 'Анна');
assert.ok(Math.abs(Date.parse(s.resume.uploadedAt) - Date.now()) < 60000, 'дата загрузки в ISO');
const up = calls.filter((c) => c.method === 'sendDocument').at(-1).params;
assert.equal(Buffer.from(up.document.bytes).toString(), '%PDF-1.4 test', 'base64 декодирован верно');

// Просмотр резюме другим участником
await ep('sendResume', { id }, oleg);
const sent = calls.filter((c) => c.method === 'sendDocument').at(-1).params;
assert.equal(sent.chat_id, oleg.id);
assert.equal(sent.document, 'FILE1');

// Резюме через чат: документ с подписью /resume <код>
await handler({ chat: { id: hr.id, type: 'private' }, from: hr, caption: `/resume ${id}`, document: { file_id: 'CHATFILE', file_name: 'cv.docx', file_size: 10 } });
assert.match(lastText(), /Резюме прикреплено/);
s = await ep('getCandidate', { id }, oleg);
assert.equal(s.resume.fileName, 'cv.docx');

// Итоги и список
await msg(hr, `/results ${id}`);
assert.match(lastText(), /Оценок: 2, средний балл: 6/);
assert.match(lastText(), /Большинство: <b>Отклонить<\/b>/);
await msg(hr, '/list');
assert.match(lastText(), /оценок: 2, есть резюме/);

// Удаление
await msg(hr, `/delete ${id}`);
await rejects(ep('getCandidate', { id }, anna), 'NOT_FOUND');
assert.equal((await db.all({ text: 'SELECT * FROM votes', values: [] })).length, 0);

// base64 на краевых случаях
const { base64ToBytes } = await import('../tgcloud/lib/rating.js');
for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
  const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) % 256));
  assert.deepEqual(Buffer.from(base64ToBytes(b.toString('base64'))), b);
}

console.log('Все проверки пройдены');
