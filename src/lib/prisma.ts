/**
 * Prisma Client Singleton
 *
 * One PrismaClient per process — reused across hot reloads in
 * development, instantiated once per cold start in production.
 *
 * Prisma 7.x requires a driver adapter. We use `@prisma/adapter-pg`
 * against a Postgres URL (Vercel Postgres in production, a local
 * Docker container for tests, your dev branch URL for local dev).
 *
 * @see https://www.prisma.io/docs/orm/overview/databases/postgresql
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createClient = () => {
  // DATABASE_URL is required. We deliberately don't fall back to
  // a default — a missing DATABASE_URL in production should fail
  // loudly at startup, not silently connect to the wrong place.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in your env (locally: .env, " +
        "production: Vercel project env vars)."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
