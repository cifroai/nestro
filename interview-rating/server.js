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

const DECISIONS = {
  accept: 'Принять',
  reject: 'Отклонить',
  reserve: 'В резерв',
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

  return {
    id: candidate.id,
    name: candidate.name,
    position: candidate.position,
    scale: { min: SCORE_MIN, max: SCORE_MAX },
    decisionsLabels: DECISIONS,
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

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

  const m = pathname.match(/^\/api\/candidates\/([A-Za-z0-9_-]{1,64})(\/vote)?$/);
  if (!m) return send(res, 404, { error: 'Не найдено' });

  const user = authenticate(req);
  if (!user) return send(res, 401, { error: 'Откройте приложение через Telegram' });

  const candidate = store.getCandidate(m[1]);
  if (!candidate) return send(res, 404, { error: 'Кандидат не найден. Проверьте ссылку.' });

  if (req.method === 'GET' && !m[2]) {
    return send(res, 200, summarize(candidate, user.id));
  }

  if (req.method === 'POST' && m[2]) {
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
  const { pathname } = new URL(req.url, 'http://x');
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
