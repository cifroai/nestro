import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * argon2id с параметрами из docs/SECURITY.md §3.
 * m=64MiB, t=3, p=1 — компромисс между стойкостью и латентностью на 8 vCPU.
 */
const OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plain: string): Promise<string> {
  assertPasswordPolicy(plain);
  return argonHash(plain, OPTIONS);
}

export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}

/** Простейший список запрещённых паролей; в production дополняется файлом 10k. */
const WEAK = new Set([
  'password', 'password123', 'qwerty123456', '123456789012', 'administrator',
  'пароль123456', 'nestro123456', 'assessment123',
]);

export function assertPasswordPolicy(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`);
  }
  if (WEAK.has(plain.toLowerCase())) {
    throw new PasswordPolicyError('Пароль слишком распространён');
  }
  if (/^(.)\1+$/.test(plain)) {
    throw new PasswordPolicyError('Пароль не должен состоять из одного повторяющегося символа');
  }
}

export class PasswordPolicyError extends Error {
  readonly code = 'PASSWORD_POLICY';
}
