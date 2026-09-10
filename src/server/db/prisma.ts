import { PrismaClient } from '@prisma/client';

/**
 * Единственная точка создания Prisma-клиента.
 * Прямые обращения к prisma допускаются только из src/server/repositories/**.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Транзакционный помощник: сервисы получают Tx и не знают о клиенте. */
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => fn(tx as Tx));
}
