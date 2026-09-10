import { createHash, createHmac } from 'node:crypto';
import { getEnv } from '../config/env.js';

/**
 * Минимальный клиент S3-совместимого хранилища (AWS Signature V4).
 * Отдельная зависимость не требуется; поддерживает MinIO и аналоги.
 */

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

function config(): S3Config {
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
    throw new Error('S3-хранилище не настроено');
  }
  return {
    endpoint: env.S3_ENDPOINT.replace(/\/+$/, ''),
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: 'us-east-1',
  };
}

function signedHeaders(
  cfg: S3Config,
  method: string,
  key: string,
  payload: Buffer,
  contentType?: string,
): { url: string; headers: Record<string, string> } {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key.replace(/^\/+/, '')}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(contentType ? { 'content-type': contentType } : {}),
  };

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaderList = sortedKeys.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, dateStamp), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaderList}, Signature=${signature}`;

  return { url: url.toString(), headers };
}

export async function putS3Object(key: string, data: Buffer, contentType: string): Promise<void> {
  const cfg = config();
  const { url, headers } = signedHeaders(cfg, 'PUT', key, data, contentType);
  const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(data) });
  if (!response.ok) {
    throw new Error(`Не удалось сохранить объект в S3: ${response.status} ${await response.text()}`);
  }
}

export async function getS3Object(key: string): Promise<Buffer> {
  const cfg = config();
  const { url, headers } = signedHeaders(cfg, 'GET', key, Buffer.alloc(0));
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Не удалось получить объект из S3: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
