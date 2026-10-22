/**
 * Pure helpers for the per-worker test databases.
 *
 * `globalSetup` pushes the schema once into the base database
 * (TEST_DATABASE_URL, default `lawcrm_test`), which then acts as a
 * TEMPLATE: it clones `<base>_w1` .. `<base>_w<maxWorkers>`, one per
 * Vitest worker. A setupFile points DATABASE_URL at the worker's own
 * clone, so files running in parallel never see each other's rows.
 * Dependency-free (no vitest/prisma imports) so vitest.config.ts,
 * globalSetup, setupFiles and unit tests can all load it.
 */

import os from "node:os";

export const DEFAULT_TEST_DB_URL =
  "postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test";

/** The base (template) database URL: TEST_DATABASE_URL or the docker default. */
export function baseTestDbUrl(env: Record<string, string | undefined> = process.env): string {
  return env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;
}

/** Database name of a Postgres URL. */
export function dbNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** `<base>_w<N>` URL for worker N (1-based, Vitest's VITEST_POOL_ID). */
export function workerDbUrl(baseUrl: string, workerId: number): string {
  const u = new URL(baseUrl);
  u.pathname = `/${dbNameOf(baseUrl)}_w${workerId}`;
  return u.toString();
}

/** Same URL, pointed at the `postgres` maintenance database. */
export function maintenanceDbUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = "/postgres";
  return u.toString();
}

/**
 * Worker count: `TEST_MAX_WORKERS` if a positive integer, else half
 * the cores capped at 4 (each worker owns a DB and a 4-connection
 * pool; more than 4 mostly adds Postgres contention).
 */
export function resolveMaxWorkers(
  env: Record<string, string | undefined> = process.env,
  cores: number = os.availableParallelism(),
): number {
  const n = Number(env.TEST_MAX_WORKERS);
  if (env.TEST_MAX_WORKERS !== undefined && Number.isInteger(n) && n >= 1) {
    return n;
  }
  return Math.min(4, Math.max(1, Math.floor(cores / 2)));
}
