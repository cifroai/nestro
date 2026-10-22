// Общая логика: кандидаты, оценки, сводка результатов.

import { db, api } from 'sdk';
import { sql } from 'sdk/db';
import {
  APP_SHORT_NAME, ADMIN_IDS, RESUME_UPLOADER_IDS, SCORE_MIN, SCORE_MAX, DECISIONS,
  RESUME_MAX_MB, RESUME_EXTENSIONS,
} from './config.js';

export function now() {
  return Math.floor(Date.now() / 1000);
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Короткий трудноугадываемый код кандидата для ссылки.
export function newId(length = 10) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = '';
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export function displayName(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (user.username) return '@' + user.username;
  return `ID ${user.id}`;
}

export function isAdmin(userId) {
  return ADMIN_IDS.length === 0 || ADMIN_IDS.includes(Number(userId));
}

export function canUploadResume(userId) {
  return RESUME_UPLOADER_IDS.length === 0 || RESUME_UPLOADER_IDS.includes(Number(userId));
}

export function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function resumeExtension(fileName) {
  const m = /\.[A-Za-z0-9]+$/.exec(String(fileName || ''));
  const ext = m ? m[0].toLowerCase() : '';
  return RESUME_EXTENSIONS.includes(ext) ? ext : null;
}

let botUsername = null;

export async function getBotUsername() {
  if (!botUsername) botUsername = (await api.getMe()).username;
  return botUsername;
}

export async function appLink(candidateId) {
  return `https://t.me/${await getBotUsername()}/${APP_SHORT_NAME}?startapp=${candidateId}`;
}

// --- Кандидаты ---

export async function getCandidate(id) {
  if (!isValidId(id)) return null;
  return (await db.get(sql`SELECT * FROM candidates WHERE id = ${id}`)) || null;
}

export async function listCandidates() {
  return db.all(sql`
    SELECT c.*, (SELECT count(*) FROM votes v WHERE v.candidate_id = c.id) AS votes_count
    FROM candidates c ORDER BY c.created_at DESC`);
}

export async function createCandidate({ name, position, createdBy }) {
  const id = newId();
  await db.run(sql`
    INSERT INTO candidates (id, name, position, created_by, created_at)
    VALUES (${id}, ${name}, ${position || ''}, ${createdBy ?? null}, ${now()})`);
  return getCandidate(id);
}

export async function deleteCandidate(id) {
  // Внешних ключей нет — сначала удаляем оценки, затем кандидата.
  await db.run(sql`DELETE FROM votes WHERE candidate_id = ${id}`);
  const res = await db.run(sql`DELETE FROM candidates WHERE id = ${id}`);
  return res.rowsAffected > 0;
}

export async function setResume(id, { fileId, fileName, size, uploadedBy }) {
  await db.run(sql`
    UPDATE candidates SET
      resume_file_id = ${fileId}, resume_file_name = ${fileName}, resume_size = ${size ?? null},
      resume_uploaded_by = ${uploadedBy}, resume_uploaded_at = ${now()}
    WHERE id = ${id}`);
}

// --- Оценки ---

export function validateVote({ score, decision, comment }) {
  const s = Number(score);
  if (!Number.isInteger(s) || s < SCORE_MIN || s > SCORE_MAX) {
    return { error: `Оценка должна быть от ${SCORE_MIN} до ${SCORE_MAX}` };
  }
  if (!Object.prototype.hasOwnProperty.call(DECISIONS, decision)) return { error: 'Выберите решение' };
  return { score: s, decision, comment: String(comment || '').trim().slice(0, 500) };
}

export async function saveVote(candidateId, user, { score, decision, comment }) {
  const t = now();
  await db.run(sql`
    INSERT INTO votes (candidate_id, user_id, name, username, score, decision, comment, created_at, updated_at)
    VALUES (${candidateId}, ${user.id}, ${displayName(user)}, ${user.username || null},
            ${score}, ${decision}, ${comment}, ${t}, ${t})
    ON CONFLICT (candidate_id, user_id) DO UPDATE SET
      name = excluded.name, username = excluded.username, score = excluded.score,
      decision = excluded.decision, comment = excluded.comment, updated_at = excluded.updated_at`);
}

export async function getVotes(candidateId) {
  return db.all(sql`SELECT * FROM votes WHERE candidate_id = ${candidateId} ORDER BY updated_at DESC, id DESC`);
}

export function aggregate(votes) {
  const count = votes.length;
  const total = votes.reduce((s, v) => s + Number(v.score), 0);
  const decisions = Object.fromEntries(Object.keys(DECISIONS).map((k) => [k, 0]));
  for (const v of votes) decisions[v.decision] = (decisions[v.decision] || 0) + 1;

  // Решение большинства; при равенстве голосов — «нет единого мнения» (null).
  let leader = null;
  const max = Math.max(0, ...Object.values(decisions));
  if (max > 0) {
    const top = Object.keys(decisions).filter((k) => decisions[k] === max);
    leader = top.length === 1 ? top[0] : null;
  }
  return { count, average: count ? Math.round((total / count) * 100) / 100 : null, decisions, leader };
}

// Данные для экрана Mini App.
export async function summarize(candidate, userId) {
  const votes = await getVotes(candidate.id);
  const mine = votes.find((v) => Number(v.user_id) === Number(userId)) || null;
  return {
    id: candidate.id,
    name: candidate.name,
    position: candidate.position,
    scale: { min: SCORE_MIN, max: SCORE_MAX },
    decisionsLabels: DECISIONS,
    bot: await getBotUsername(),
    resume: candidate.resume_file_id
      ? {
          fileName: candidate.resume_file_name,
          size: candidate.resume_size,
          uploadedBy: candidate.resume_uploaded_by,
          uploadedAt: new Date(candidate.resume_uploaded_at * 1000).toISOString(),
        }
      : null,
    canUploadResume: canUploadResume(userId),
    resumeTypes: RESUME_EXTENSIONS,
    resumeMaxMb: RESUME_MAX_MB,
    myVote: mine ? { score: mine.score, decision: mine.decision, comment: mine.comment } : null,
    // Результаты видны только тем, кто уже проголосовал, чтобы не влиять на оценку.
    results: mine
      ? {
          ...aggregate(votes),
          votes: votes.map((v) => ({ name: v.name, score: v.score, decision: v.decision, comment: v.comment })),
        }
      : null,
  };
}

// --- Base64 (в среде выполнения нет Buffer, atob может отсутствовать) ---

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

export function base64ToBytes(str) {
  const clean = String(str).replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) throw new Error('invalid base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, j);
}
