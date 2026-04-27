/**
 * Vitest `globalSetup` for layer-3 integration tests.
 *
 * Runs ONCE before any test file loads. Responsibilities:
 *   1. Point `DATABASE_URL` at a dedicated test SQLite file so
 *      every prisma client constructed during the run targets it
 *      instead of the dev DB.
 *   2. Push the Prisma schema to that file via `prisma db push`
 *      (skip-generate to avoid regenerating the client we already
 *      have on disk).
 *   3. On test-run teardown, delete the file so re-runs always
 *      start from scratch.
 *
 * The setup deliberately does NOT seed any data — fixtures are
 * per-test responsibility (see `src/test/integration-helpers.ts`).
 * Each integration test calls `resetDb()` in `beforeEach` so it
 * gets a clean DB regardless of what the prior test left behind.
 */

import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

// Test DB file lives alongside the dev DB. Prisma's CLI resolves
// relative paths against the project root, so we use the same
// "file:./..." form the dev URL uses.
const TEST_DB_RELATIVE = "./prisma/test.db";
const TEST_DB_URL = `file:${TEST_DB_RELATIVE}`;

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DB_URL;

  // Resolve absolute path so we can delete the file from any CWD.
  const projectRoot = path.resolve(__dirname, "../..");
  const dbPath = path.resolve(projectRoot, "prisma/test.db");
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  // Push the current schema to the test DB. Prisma 7 dropped
  // `--skip-generate`; the generated client on disk is fine
  // anyway. `--accept-data-loss` because the file is fresh.
  // `--url` overrides the datasource — Prisma 7's config-based
  // URL takes precedence over env vars otherwise. Stdio inherit
  // so any schema-validation error surfaces in the test runner.
  execSync(
    `npx prisma db push --accept-data-loss --url "${TEST_DB_URL}"`,
    {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: "inherit",
    }
  );
}

export async function teardown(): Promise<void> {
  const projectRoot = path.resolve(__dirname, "../..");
  const dbPath = path.resolve(projectRoot, "prisma/test.db");
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
}
