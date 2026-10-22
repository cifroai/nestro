// Локальный стенд интерфейса: раздаёт public/ и выполняет endpoints на заглушках SDK.
// node --experimental-sqlite test/serve.js  → http://localhost:3200
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
register('./hooks.js', import.meta.url);

const { db, EndpointError } = await import('./sdk/index.js');
const { ddl } = await import('./sdk/db.js');
await import('../tgcloud/schema.js');
for (const s of ddl()) db._exec(s);
const { createCandidate } = await import('../tgcloud/lib/rating.js');
const c = await createCandidate({ name: 'Иванов Иван', position: 'Ведущий аналитик' });
console.log('candidate', c.id);

const pub = path.join(import.meta.dirname, '..', 'public');
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/(\w+)$/);
  if (m && req.method === 'POST') {
    let body = '';
    for await (const ch of req) body += ch;
    const user = JSON.parse(decodeURIComponent(req.headers['x-test-user']));
    try {
      const mod = await import(`../tgcloud/endpoints/${m[1]}.js`);
      const result = await mod.default(JSON.parse(body || '{}'), { initData: { user } });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.statusCode = e instanceof EndpointError ? 400 : 500;
      res.end(JSON.stringify(e instanceof EndpointError
        ? { ok: false, error_type: 'ENDPOINT_ERROR', description: e.description, parameters: e.parameters }
        : { ok: false, error_type: 'INTERNAL', description: String(e) }));
    }
    return;
  }
  const f = path.join(pub, url.pathname === '/' ? 'index.html' : url.pathname);
  fs.readFile(f, (err, data) => { if (err) { res.statusCode = 404; res.end(); } else res.end(data); });
}).listen(3200);
