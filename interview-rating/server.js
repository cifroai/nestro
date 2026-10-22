'use strict';

// Telegram Mini App для оценки кандидатов по итогам собеседования.
// Без внешних зависимостей: Node.js >= 18.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const SCORE_MIN = Number(process.env.SCORE_MIN || 1);
const SCORE_MAX = Number(process.env.SCORE_MAX || 10);
// Сколько секунд initData считается действительной (по умолчанию сутки).
const INIT_DATA_TTL = Number(process.env.INIT_DATA_TTL || 86400);
// DEV_MODE=1 разрешает открывать приложение в обычном браузере без Telegram (только для отладки).
const DEV_MODE = process.env.DEV_MODE === '1';
// Максимальный размер файла резюме, МБ.
const RESUME_MAX_MB = Number(process.env.RESUME_MAX_MB || 10);
// Сколько секунд действует ссылка на просмотр резюме.
const RESUME_LINK_TTL = Number(process.env.RESUME_LINK_TTL || 3600);
// Telegram ID через запятую, кому разрешено загружать резюме. Пусто — любому участнику.
const RESUME_UPLOADERS = (process.env.RESUME_UPLOADERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LINK_SECRET = crypto
  .createHash('sha256')
  .update('resume-link:' + (BOT_TOKEN || crypto.randomBytes(32).toString('hex')))
  .digest();

const DECISIONS = {
  accept: 'Принять',
  reject: 'Отклонить',
  reserve: 'В резерв',
};

// Допустимые форматы резюме: расширение → MIME-тип при отдаче.
const RESUME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

if (!BOT_TOKEN && !DEV_MODE) {
  console.error('Не задан BOT_TOKEN. Укажите токен бота из @BotFather (или DEV_MODE=1 для локальной отладки).');
  process.exit(1);
}

// Проверка подписи initData по алгоритму Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_TTL) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !user.id) return null;
  return { user, startParam: params.get('start_param') || null };
}

function authenticate(req) {
  const initData = req.headers['x-telegram-init-data'];
  if (initData && BOT_TOKEN) {
    const verified = verifyInitData(String(initData));
    if (verified) return verified.user;
    return null;
  }
  if (DEV_MODE) {
    const devId = decodeURIComponent(String(req.headers['x-dev-user'] || 'dev'));
    return { id: `dev:${devId}`, first_name: devId };
  }
  return null;
}

function displayName(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (user.username) return '@' + user.username;
  return `ID ${user.id}`;
}

function summarize(candidate, userId) {
  const votes = Object.values(candidate.votes);
  const count = votes.length;
  const total = votes.reduce((s, v) => s + v.score, 0);
  const decisions = Object.fromEntries(Object.keys(DECISIONS).map((k) => [k, 0]));
  for (const v of votes) decisions[v.decision] = (decisions[v.decision] || 0) + 1;

  // Итоговое решение — вариант с наибольшим числом голосов (при равенстве — «нет единого мнения»).
  let leader = null;
  const max = Math.max(0, ...Object.values(decisions));
  if (max > 0) {
    const top = Object.keys(decisions).filter((k) => decisions[k] === max);
    leader = top.length === 1 ? top[0] : null;
  }

  const myVote = userId != null ? candidate.votes[String(userId)] || null : null;
  const resume = candidate.resume
    ? {
        fileName: candidate.resume.fileName,
        size: candidate.resume.size,
        uploadedBy: candidate.resume.uploadedBy,
        uploadedAt: candidate.resume.uploadedAt,
        url: resumeLink(candidate),
      }
    : null;

  return {
    id: candidate.id,
    name: candidate.name,
    position: candidate.position,
    scale: { min: SCORE_MIN, max: SCORE_MAX },
    decisionsLabels: DECISIONS,
    resume,
    canUploadResume: canUploadResume(userId),
    resumeTypes: Object.keys(RESUME_TYPES),
    resumeMaxMb: RESUME_MAX_MB,
    myVote,
    // Результаты показываем только тем, кто уже проголосовал, чтобы не влиять на оценку.
    results: myVote
      ? {
          count,
          average: count ? Math.round((total / count) * 100) / 100 : null,
          decisions,
          leader,
          votes: votes
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((v) => ({ name: v.name, score: v.score, decision: v.decision, comment: v.comment || '' })),
        }
      : null,
  };
}

function canUploadResume(userId) {
  return RESUME_UPLOADERS.length === 0 || RESUME_UPLOADERS.includes(String(userId));
}

function signResume(id, file, exp) {
  return crypto.createHmac('sha256', LINK_SECRET).update(`${id}:${file}:${exp}`).digest('base64url');
}

// Ссылка на файл подписана и ограничена по времени: её можно открыть во внешнем браузере
// (вне Telegram), но нельзя подобрать или использовать бессрочно.
function resumeLink(candidate) {
  const exp = Math.floor(Date.now() / 1000) + RESUME_LINK_TTL;
  const sig = signResume(candidate.id, candidate.resume.file, exp);
  return `/resume/${candidate.id}?exp=${exp}&sig=${sig}`;
}

function serveResume(req, res, id, query) {
  const candidate = store.getCandidate(id);
  const exp = Number(query.get('exp'));
  const sig = String(query.get('sig') || '');
  const valid =
    candidate &&
    candidate.resume &&
    exp > Date.now() / 1000 &&
    sig.length > 0 &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(sig).digest(),
      crypto.createHash('sha256').update(signResume(id, candidate.resume.file, exp)).digest(),
    );
  if (!valid) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ссылка недействительна или устарела. Откройте резюме заново из приложения.');
    return;
  }
  const { file, fileName } = candidate.resume;
  const ext = path.extname(file).toLowerCase();
  fs.readFile(path.join(store.RESUME_DIR, file), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Файл не найден');
      return;
    }
    res.writeHead(200, {
      'Content-Type': RESUME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    // При превышении лимита дочитываем запрос без сохранения, чтобы клиент получил ответ с ошибкой.
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => (size > limit ? reject(new Error('too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readBody(req, limit = 16 * 1024) {
  const raw = await readRaw(req, limit);
  return JSON.parse(raw.toString('utf8') || '{}');
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/config') {
    return send(res, 200, { devMode: DEV_MODE });
  }

  const m = pathname.match(/^\/api\/candidates\/([A-Za-z0-9_-]{1,64})(\/vote|\/resume)?$/);
  if (!m) return send(res, 404, { error: 'Не найдено' });

  const user = authenticate(req);
  if (!user) return send(res, 401, { error: 'Откройте приложение через Telegram' });

  const candidate = store.getCandidate(m[1]);
  if (!candidate) return send(res, 404, { error: 'Кандидат не найден. Проверьте ссылку.' });

  if (req.method === 'GET' && !m[2]) {
    return send(res, 200, summarize(candidate, user.id));
  }

  if (req.method === 'POST' && m[2] === '/resume') {
    if (!canUploadResume(user.id)) return send(res, 403, { error: 'Загрузка резюме вам недоступна' });
    let fileName;
    try {
      fileName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
    } catch {
      fileName = '';
    }
    fileName = path.basename(fileName).slice(0, 200);
    const ext = path.extname(fileName).toLowerCase();
    if (!RESUME_TYPES[ext]) {
      return send(res, 400, { error: 'Допустимые форматы: ' + Object.keys(RESUME_TYPES).join(', ') });
    }
    if (Number(req.headers['content-length']) > RESUME_MAX_MB * 1024 * 1024) {
      return send(res, 413, { error: `Файл больше ${RESUME_MAX_MB} МБ` });
    }
    let data;
    try {
      data = await readRaw(req, RESUME_MAX_MB * 1024 * 1024);
    } catch {
      return send(res, 413, { error: `Файл больше ${RESUME_MAX_MB} МБ` });
    }
    if (!data.length) return send(res, 400, { error: 'Пустой файл' });
    const updated = store.saveResume(candidate.id, { fileName, ext, data, uploadedBy: displayName(user) });
    return send(res, 200, summarize(updated, user.id));
  }

  if (req.method === 'POST' && m[2] === '/vote') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: 'Некорректный запрос' });
    }
    const score = Number(body.score);
    const decision = String(body.decision || '');
    const comment = String(body.comment || '').trim().slice(0, 500);
    if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
      return send(res, 400, { error: `Оценка должна быть от ${SCORE_MIN} до ${SCORE_MAX}` });
    }
    if (!DECISIONS[decision]) return send(res, 400, { error: 'Выберите решение' });

    const updated = store.saveVote(candidate.id, String(user.id), {
      name: displayName(user),
      username: user.username || null,
      score,
      decision,
      comment,
    });
    return send(res, 200, summarize(updated, user.id));
  }

  return send(res, 405, { error: 'Метод не поддерживается' });
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://x');
  const resumeMatch = pathname.match(/^\/resume\/([A-Za-z0-9_-]{1,64})$/);
  if (resumeMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    serveResume(req, res, resumeMatch[1], searchParams);
    return;
  }
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((e) => {
      console.error(e);
      send(res, 500, { error: 'Внутренняя ошибка сервера' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Interview rating app: http://localhost:${PORT}${DEV_MODE ? ' (DEV_MODE)' : ''}`);
  });
}

module.exports = { server, verifyInitData };
