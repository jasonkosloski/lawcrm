/**
 * Prisma Client Singleton
 *
 * One PrismaClient per process — reused across hot reloads in
 * development, reused across requests within a warm Lambda in
 * production.
 *
 * Prisma 7.x requires a driver adapter. We use `@prisma/adapter-pg`
 * against a Postgres URL (Prisma Postgres in production, a local
 * Docker container for tests, your dev DB for local dev).
 *
 * **Connection-pool sizing:** the default `pg` pool is 10 connections
 * per process, and Postgres has a hard connection cap (Prisma
 * Postgres starts small), so the pool is bounded explicitly - but not
 * at 1. Vercel's Fluid compute runs many invocations concurrently in
 * ONE instance sharing this module-level pool, and pages fan out
 * parallel queries (the dashboard runs ~30, search ~21). A single
 * connection serializes all of it, and one interactive
 * `$transaction` (it pins its connection until commit) would starve
 * every other request on the instance until Prisma's 2 s `maxWait`
 * aborts the next transaction start with P2028.
 *
 * Default 5 per instance; override with `DATABASE_POOL_MAX` once you
 * know the plan's connection cap (instances x max must stay below
 * it). The integration tests set it so concurrent transactions really
 * overlap on separate connections (see src/test/integration-setup.ts).
 * `connectionTimeoutMillis` makes a saturated pool fail fast instead
 * of waiting forever; idle connections are released after 30 s.
 *
 * **Cache to globalThis in every env:** the legacy "dev only"
 * Prisma cookbook pattern was about hot-module reloads in `next
 * dev`. In production it's also defensive — Turbopack and the
 * Next 16 module graph occasionally re-evaluate this module, and
 * the global cache prevents a stray re-eval from spawning a fresh
 * client (and a fresh connection) per request.
 *
 * @see https://www.prisma.io/docs/orm/overview/databases/postgresql
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { emailTokenEncryption } from "@/lib/email-token-encryption";

const DEFAULT_POOL_MAX = 5;

/** Pool size from `DATABASE_POOL_MAX` (a positive integer), else the default. */
export function resolvePoolMax(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= 1
    ? n
    : DEFAULT_POOL_MAX;
}

const createClient = () => {
  // DATABASE_URL is required. We deliberately don't fall back to a
  // default — a missing DATABASE_URL in production should fail
  // loudly at startup, not silently connect to the wrong place.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in your env (locally: .env, " +
        "production: Vercel project env vars)."
    );
  }
  // Bounded pool - see file header for the sizing reasoning.
  const adapter = new PrismaPg({
    connectionString,
    max: resolvePoolMax(process.env.DATABASE_POOL_MAX),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // OAuth token fields encrypt-at-rest via a query extension — see
  // src/lib/email-token-encryption.ts.
  return new PrismaClient({ adapter }).$extends(emailTokenEncryption);
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();

// Cache globally regardless of NODE_ENV — see file header.
globalForPrisma.prisma = prisma;

/**
 * The client shape inside `prisma.$transaction(async (tx) => ...)`.
 * Use this (not `Prisma.TransactionClient`) for helper params — the
 * extended client has its own transaction type, and the generated
 * `TransactionClient` no longer matches it.
 */
export type Tx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
