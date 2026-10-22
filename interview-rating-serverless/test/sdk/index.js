// Локальная заглушка 'sdk' для тестов: db на node:sqlite, api записывает вызовы.
import { DatabaseSync } from 'node:sqlite';

const conn = new DatabaseSync(':memory:');
const bind = (q) => q.values.map((v) => (typeof v === 'boolean' ? Number(v) : v === undefined ? null : v));

export const db = {
  _exec: (s) => conn.exec(s),
  async all(q) { return conn.prepare(q.text).all(...bind(q)).map((r) => ({ ...r })); },
  async get(q) { const r = conn.prepare(q.text).get(...bind(q)); return r ? { ...r } : undefined; },
  async run(q) { const r = conn.prepare(q.text).run(...bind(q)); return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] }; },
};

export class BotApiError extends Error {
  constructor(code, description) { super(description); this.code = code; this.description = description; }
}
export class EndpointError extends Error {
  constructor(description, parameters) { super(description); this.description = description; this.parameters = parameters; }
}
export class InputFile {
  constructor(bytes, name, opts = {}) { this.bytes = bytes; this.name = name; this.type = opts.type; }
}

export const calls = [];
export const blockedUsers = new Set();
let fileSeq = 0;
export const api = new Proxy({}, {
  get: (_, method) => async (params) => {
    calls.push({ method, params });
    if (params && blockedUsers.has(params.chat_id)) throw new BotApiError(403, 'Forbidden: bot was blocked by the user');
    if (method === 'getMe') return { id: 1, is_bot: true, username: 'nestro_hr_bot' };
    if (method === 'sendDocument') {
      const d = params.document;
      return d instanceof InputFile
        ? { message_id: 1, document: { file_id: `FILE${++fileSeq}`, file_name: d.name, file_size: d.bytes.length } }
        : { message_id: 1, document: { file_id: d } };
    }
    return { message_id: 1 };
  },
});
