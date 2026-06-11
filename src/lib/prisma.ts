/**
 * Prisma Client Singleton
 *
 * One PrismaClient per process — reused across hot reloads in
 * development, reused across requests within a warm Lambda in
 * production.
 *
 * Prisma 7.x requires a driver adapter. We use `@prisma/adapter-pg`
 * against a Postgres URL (Vercel Postgres in production, a local
 * Docker container for tests, your dev DB for local dev).
 *
 * **Serverless connection-pool sizing:** the default `pg` pool is
 * 10 connections per process. In serverless that's a foot-gun —
 * each Lambda gets its own pool, and Postgres has a hard
 * connection cap (Vercel Postgres / Prisma Postgres start at ~20
 * for hobby tiers). A single Lambda only handles one request at a
 * time, so anything above 1 just wastes a connection slot. We cap
 * the pool at 1 here. If you need higher per-Lambda concurrency
 * (e.g. parallel queries inside a single request), bump this — but
 * also make sure your Postgres tier has the headroom.
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
  // Cap pool at 1 connection — see file header for the reasoning.
  const adapter = new PrismaPg({ connectionString, max: 1 });
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
