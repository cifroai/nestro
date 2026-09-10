import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findForbiddenTerms } from '../src/lib/forbiddenVocabulary.js';

/**
 * Поиск запрещённой лексики в пользовательских текстах (§18, §22).
 *
 * Сканируются строковые литералы с кириллицей. Из проверки исключаются:
 *  — сам каталог запрещённых терминов;
 *  — комментарии;
 *  — формулировки-запреты (в промптах и оговорках эти слова присутствуют
 *    именно как перечень недопустимого).
 */

export interface VocabularyHit {
  file: string;
  line: number;
  text: string;
  term: string;
}

const EXCLUDED_FILES = ['src/lib/forbiddenVocabulary.ts'];

const PROHIBITION_MARKERS = [
  'НЕ ',
  'не содержит',
  'не являются',
  'не является',
  'не равно',
  'запрещ',
  'недопустим',
  'не употребляешь',
  'не используются',
  'не используй',
  'не должна',
  'не должен',
];

const STRING_LITERAL = /'([^'\\\n]*[А-Яа-яЁё][^'\\\n]*)'|"([^"\\\n]*[А-Яа-яЁё][^"\\\n]*)"/g;

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(path, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
}

export function scanSources(roots: string[] = ['src']): { hits: VocabularyHit[]; scannedLiterals: number } {
  const files: string[] = [];
  for (const root of roots) walk(root, files);

  const hits: VocabularyHit[] = [];
  let scannedLiterals = 0;

  for (const file of files) {
    if (EXCLUDED_FILES.some((excluded) => file.endsWith(excluded))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');

    for (const [index, line] of lines.entries()) {
      if (isComment(line)) continue;
      for (const match of line.matchAll(STRING_LITERAL)) {
        const text = match[1] ?? match[2] ?? '';
        if (text.length <= 3) continue;
        scannedLiterals += 1;
        if (PROHIBITION_MARKERS.some((marker) => line.includes(marker))) continue;
        for (const violation of findForbiddenTerms(text)) {
          hits.push({ file, line: index + 1, text, term: violation.term });
        }
      }
    }
  }

  return { hits, scannedLiterals };
}

/** Проверка модели данных: защищаемые характеристики не должны быть полями. */
export function scanSchemaFields(schemaPath = 'prisma/schema.prisma'): string[] {
  const forbiddenFields = [
    'gender',
    'sex',
    'age',
    'birthDate',
    'nationality',
    'ethnicity',
    'religion',
    'maritalStatus',
    'healthStatus',
    'disability',
    'politicalViews',
  ];
  const content = readFileSync(schemaPath, 'utf8');
  const declared = new Set(
    [...content.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s+\S/gm)].map((match) => match[1] as string),
  );
  return forbiddenFields.filter((field) => declared.has(field));
}

const isCli = process.argv[1]?.endsWith('vocabularyScan.ts') ?? false;
if (isCli) {
  const { hits, scannedLiterals } = scanSources();
  const schemaViolations = scanSchemaFields();
  for (const hit of hits) {
    process.stdout.write(`${hit.file}:${hit.line} [${hit.term}] ${hit.text.slice(0, 140)}\n`);
  }
  for (const field of schemaViolations) {
    process.stdout.write(`prisma/schema.prisma [защищаемая характеристика] поле ${field}\n`);
  }
  process.stdout.write(
    `Проверено литералов: ${scannedLiterals}; нарушений: ${hits.length + schemaViolations.length}\n`,
  );
  process.exit(hits.length + schemaViolations.length > 0 ? 1 : 0);
}
