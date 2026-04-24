/**
 * Prisma Client Singleton
 *
 * Ensures a single PrismaClient instance is reused across hot reloads in
 * development. In production, a new instance is created once per process.
 *
 * Prisma 7.x reads the datasource URL from prisma.config.ts automatically.
 *
 * @see https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prevent-hot-reloading-from-creating-new-instances
 */

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (PrismaClient as any)();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
