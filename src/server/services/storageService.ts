import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';

/**
 * Хранилище файлов отчётов и экспортов.
 * По умолчанию — локальный том; при заданных S3_* переменных используется
 * S3-совместимое хранилище (docs/DEPLOYMENT.md §4).
 *
 * Файлы никогда не публикуются: выдача идёт через API с проверкой прав (T16).
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
}

function localPath(key: string): string {
  const env = getEnv();
  const base = resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
  const target = resolve(base, key);
  // Защита от выхода за пределы каталога хранения.
  if (!target.startsWith(base)) throw new Error('Недопустимый путь объекта хранения');
  return target;
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
  const env = getEnv();
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
    // S3-совместимое хранилище: подпись AWS4 выполняется минимальным клиентом.
    const { putS3Object } = await import('./s3Client.js');
    await putS3Object(key, data, contentType);
    return { key, sizeBytes: data.byteLength };
  }
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  logger.debug({ key, sizeBytes: data.byteLength }, 'объект сохранён локально');
  return { key, sizeBytes: data.byteLength };
}

export async function getObject(key: string): Promise<Buffer> {
  const env = getEnv();
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
    const { getS3Object } = await import('./s3Client.js');
    return getS3Object(key);
  }
  return readFile(localPath(key));
}

export function reportKey(sessionId: string, renderedAt: Date): string {
  const stamp = renderedAt.toISOString().replace(/[:.]/g, '-');
  return join('reports', sessionId, `report-${stamp}.pdf`);
}

export function exportKey(kind: string, stamp: Date, extension: string): string {
  return join('exports', kind, `${stamp.toISOString().replace(/[:.]/g, '-')}.${extension}`);
}
