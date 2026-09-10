import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/server/http/openapi.js';

/** Выгрузка спецификации в файл для внешних потребителей и проверки в CI. */
const target = process.argv[2] ?? 'docs/openapi.json';
const document = buildOpenApiDocument(process.env.APP_URL ?? 'http://localhost:3000');
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
process.stdout.write(`Спецификация записана в ${target}\n`);
