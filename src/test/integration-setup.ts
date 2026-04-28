/**
 * Vitest `globalSetup` for layer-3 integration tests.
 *
 * Runs ONCE before any test file loads. Responsibilities:
 *   1. Point `DATABASE_URL` at the local test Postgres (started
 *      via `docker compose -f docker-compose.test.yml up -d`).
 *   2. Wait for the DB to accept connections (the Docker
 *      healthcheck handles most of this; we add a small retry
 *      loop for the case where someone runs `vitest` faster than
 *      the container can finish booting).
 *   3. `prisma db push` the current schema so test files start
 *      against a known shape. The schema lives at one place;
 *      tests don't carry their own migrations.
 *   4. Each test calls `resetDb()` (see integration-helpers) in
 *      `beforeEach` to TRUNCATE every table, so tests stay
 *      independent without recreating the schema each time.
 *
 * No data seeding here — fixtures are per-test responsibility.
 */

import { execSync } from "node:child_process";
import { Client } from "pg";

const TEST_DB_URL =
  "postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test";

async function waitForDatabase(): Promise<void> {
  // Healthcheck poll. Docker's `--wait` flag handles this when
  // the user starts the container with `docker compose up -d --wait`,
  // but a vanilla `up -d` returns the moment the container is
  // running, before Postgres is ready to accept connections.
  // 30s is plenty for a fresh boot.
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: TEST_DB_URL });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    "Could not connect to the test Postgres at " +
      TEST_DB_URL +
      " within 30s. " +
      "Did you start it with `docker compose -f docker-compose.test.yml up -d`?\n" +
      "Last error: " +
      String(lastError)
  );
}

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DB_URL;
  // Direct URL is the same as the pooled URL for the local test
  // container — no pgbouncer in front of it.
  process.env.DIRECT_DATABASE_URL = TEST_DB_URL;

  await waitForDatabase();

  // Push the current schema. `--accept-data-loss` is fine — the
  // tmpfs container starts empty on every boot, and `resetDb()`
  // clears rows between tests, so we never carry data between
  // schema iterations.
  execSync(`npx prisma db push --accept-data-loss`, {
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      DIRECT_DATABASE_URL: TEST_DB_URL,
    },
    stdio: "inherit",
  });
}

export async function teardown(): Promise<void> {
  // Nothing to do — the container is the user's responsibility
  // (it lives across test runs so they don't pay the schema-push
  // cost every time). To wipe state, restart the container; to
  // shut it down, run `docker compose -f docker-compose.test.yml
  // down`.
}
