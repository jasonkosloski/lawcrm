/**
 * Prisma Client Singleton
 *
 * Ensures a single PrismaClient instance is reused across hot reloads in
 * development. In production, a new instance is created once per process.
 *
 * Prisma 7.x requires a driver adapter — we use `@prisma/adapter-better-sqlite3`
 * for local dev (SQLite). Swap to `@prisma/adapter-pg` + a Postgres URL for prod.
 *
 * @see https://www.prisma.io/docs/orm/overview/databases/sqlite
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createClient = () => {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
