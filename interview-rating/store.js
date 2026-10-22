'use strict';

// Простое файловое хранилище (JSON). Для небольшого числа оценщиков этого достаточно.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const RESUME_DIR = path.join(path.dirname(DB_FILE), 'resumes');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { candidates: {} };
  }
}

// Файл перечитывается при каждой операции, чтобы CLI-скрипт и сервер не затирали изменения друг друга.
function persist(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function getCandidate(id) {
  const db = load();
  return db.candidates[id] || null;
}

function listCandidates() {
  const db = load();
  return Object.values(db.candidates);
}

function addCandidate({ name, position, id }) {
  const db = load();
  const candidateId = id || crypto.randomBytes(6).toString('base64url');
  if (db.candidates[candidateId]) throw new Error(`Кандидат с id "${candidateId}" уже существует`);
  db.candidates[candidateId] = {
    id: candidateId,
    name,
    position: position || '',
    createdAt: new Date().toISOString(),
    votes: {},
  };
  persist(db);
  return db.candidates[candidateId];
}

function removeCandidate(id) {
  const db = load();
  if (!db.candidates[id]) return false;
  removeResumeFile(db.candidates[id]);
  delete db.candidates[id];
  persist(db);
  return true;
}

function saveVote(candidateId, userId, vote) {
  const db = load();
  const candidate = db.candidates[candidateId];
  const prev = candidate.votes[userId];
  const now = new Date().toISOString();
  candidate.votes[userId] = { ...vote, createdAt: prev ? prev.createdAt : now, updatedAt: now };
  persist(db);
  return candidate;
}

function removeResumeFile(candidate) {
  if (!candidate.resume) return;
  fs.rmSync(path.join(RESUME_DIR, candidate.resume.file), { force: true });
}

// Сохраняет файл резюме, заменяя предыдущий. data — Buffer, ext — расширение с точкой.
function saveResume(candidateId, { fileName, ext, data, uploadedBy }) {
  const db = load();
  const candidate = db.candidates[candidateId];
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  // Имя файла на диске не зависит от присланного имени — исключает подмену пути.
  const file = `${candidateId}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(RESUME_DIR, file), data);
  removeResumeFile(candidate);
  candidate.resume = { file, fileName, size: data.length, uploadedBy, uploadedAt: new Date().toISOString() };
  persist(db);
  return candidate;
}

module.exports = {
  getCandidate,
  listCandidates,
  addCandidate,
  removeCandidate,
  saveVote,
  saveResume,
  DB_FILE,
  RESUME_DIR,
};
