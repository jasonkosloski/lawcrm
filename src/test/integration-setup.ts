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
 *   3. Take a session-level advisory lock (on the `postgres` maintenance
 *      DB, keyed by the base DB name) for the
 *      whole run, so a second `vitest` process aimed at the SAME
 *      database (a commit hook plus a manual `npm test`, two agent
 *      sessions) queues behind the first instead of wiping its rows
 *      mid-test. Runs that need to go in parallel use separate
 *      databases via `TEST_DATABASE_URL` (see below).
 *   4. `prisma db push` the current schema so test files start
 *      against a known shape. The schema lives at one place;
 *      tests don't carry their own migrations. (Migration drift
 *      against schema.prisma is checked separately by
 *      `npm run check:migrations`, which the pre-commit hook runs
 *      when prisma/ changes.)
 *   5. Clone the pushed base DB into one database per Vitest worker
 *      (`<base>_w1..N`, CREATE DATABASE ... TEMPLATE). The setupFile
 *      `worker-db-setup.ts` points each worker at its own clone, so
 *      test files run in parallel without sharing rows.
 *   6. Each test calls `resetDb()` (see integration-helpers) in
 *      `beforeEach` to DELETE FROM every table of ITS worker's DB, so
 *      tests stay independent without recreating the schema each time.
 *
 * No data seeding here — fixtures are per-test responsibility.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { assertTestDatabaseUrl } from "./test-db-guard";
import {
  baseTestDbUrl,
  dbNameOf,
  maintenanceDbUrl,
  resolveMaxWorkers,
  workerDbUrl,
} from "./test-db-config";

// TEST_DATABASE_URL lets two suites run at once on one machine (e.g.
// parallel git worktrees), each against its own database in the same
// container: `createdb -U lawcrm_test lawcrm_test_2` inside it, then
// point this at .../lawcrm_test_2. It must still be a local database
// named lawcrm_test* (assertTestDatabaseUrl) — setup() force-pushes
// the schema and every test deletes all rows.
const TEST_DB_URL = baseTestDbUrl();
// The run lock lives on the `postgres` maintenance database, not the
// base one: CREATE DATABASE ... TEMPLATE needs the template to have
// zero other connections, so nothing may stay connected to it.
const LOCK_DB_URL = maintenanceDbUrl(TEST_DB_URL);

/** Arbitrary constant naming "an integration run owns this database". */
export const RUN_LOCK_KEY = 727_001_001;
const LOCK_POLL_MS = 1_000;
const LOCK_TIMEOUT_MS = Number(process.env.TEST_DB_LOCK_TIMEOUT_MS ?? 600_000);

let lockClient: Client | null = null;

/**
 * Interactive sessions (`vitest` watch, `--ui`) stay alive for hours.
 * Holding the run lock there would make every commit hook's `npm test`
 * wait out the timeout and fail, so they skip it (as before this
 * lock existed). One-shot runs queue.
 */
export function shouldHoldRunLock(config: { watch?: boolean; ui?: boolean }): boolean {
  return !config.watch && !config.ui;
}

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
      String(lastError),
  );
}

/**
 * Hold a session-level advisory lock for the whole run. Postgres
 * drops it automatically when the connection dies (Ctrl-C, crash),
 * so a killed run can never wedge the next one. Polls instead of
 * blocking so a stuck holder produces a clear error, not a hung hook.
 */
async function acquireRunLock(): Promise<void> {
  const client = new Client({ connectionString: LOCK_DB_URL });
  // A Postgres restart mid-run emits 'error' on an idle client; with no
  // listener that would crash the globalSetup process. Postgres drops
  // the lock with the connection, so there is nothing to recover here.
  client.on("error", () => {});
  await client.connect();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let announced = false;
  for (;;) {
    // Two-int form: (RUN_LOCK_KEY, hash of the base database name), so
    // different base databases on one server don't block each other.
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked",
      [RUN_LOCK_KEY, dbNameOf(TEST_DB_URL)],
    );
    if (res.rows[0]?.locked) {
      lockClient = client;
      return;
    }
    if (!announced) {
      announced = true;
      console.warn(
        "[integration-setup] Another test run is using this database (likely another `vitest` run " +
          "or a one-shot `npm test` from a commit hook or agent session); waiting for it to finish. " +
          "To run in parallel, point TEST_DATABASE_URL at its own database.",
      );
    }
    if (Date.now() >= deadline) {
      await client.end().catch(() => {});
      throw new Error(
        `Another test run held the lock on ${TEST_DB_URL} for ${LOCK_TIMEOUT_MS} ms ` +
          "(likely another `vitest` run or session on this database). " +
          "Wait for it, or give this run its own database via TEST_DATABASE_URL.",
      );
    }
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * (Re)create `<base>_w1..N` as clones of the freshly pushed base DB.
 * Stale clones from a previous run are dropped first (WITH FORCE, in
 * case a crashed run left connections). Runs on the maintenance DB.
 */
async function refreshWorkerDatabases(count: number): Promise<void> {
  const base = dbNameOf(TEST_DB_URL);
  const admin = new Client({ connectionString: LOCK_DB_URL });
  await admin.connect();
  try {
    // The template must have no other sessions (Prisma's connections
    // from db push are closed by now; this is belt and braces).
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [base],
    );
    for (let n = 1; n <= count; n++) {
      const url = workerDbUrl(TEST_DB_URL, n);
      assertTestDatabaseUrl(url, "worker database");
      const name = quoteIdent(dbNameOf(url));
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${quoteIdent(base)}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

export async function setup(project: TestProject): Promise<void> {
  // Vitest projects (vitest.config.ts) inherit globalSetup and call it once
  // per project in the same process, possibly from a freshly loaded copy of
  // this module (so a module-level flag is not enough). A second call would
  // deadlock on our own run lock and re-clone databases under the first
  // project's feet. process.env is shared across the copies.
  if (process.env.LAWCRM_TEST_GLOBAL_SETUP_DONE === "1") return;
  process.env.LAWCRM_TEST_GLOBAL_SETUP_DONE = "1";
  // Never force-push a schema into anything but a local test DB, even
  // if TEST_DATABASE_URL was pointed somewhere else by mistake.
  assertTestDatabaseUrl(TEST_DB_URL, "TEST_DATABASE_URL");

  process.env.DATABASE_URL = TEST_DB_URL;
  // Direct URL is the same as the pooled URL for the local test
  // container — no pgbouncer in front of it.
  process.env.DIRECT_DATABASE_URL = TEST_DB_URL;
  // More than one pooled connection, so tests that fire concurrent
  // transactions (invoice payments, trust disbursements, role
  // demotions) really overlap on separate connections instead of
  // queueing behind a single one. Respect an explicit override.
  process.env.DATABASE_POOL_MAX ??= "4";

  await waitForDatabase();
  if (shouldHoldRunLock(project.vitest.config)) {
    await acquireRunLock();
  }

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

  await applyMigrationTriggers();

  await refreshWorkerDatabases(project.vitest.config.maxWorkers || resolveMaxWorkers());
}

/** `db push` creates tables only; raw-SQL triggers live in migrations.
 *  Install the transcript purge trigger so tests see prod behaviour. */
async function applyMigrationTriggers(): Promise<void> {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20261021220000_transcript_purges/migration.sql"),
    "utf8",
  );
  const trigger = sql.slice(sql.indexOf("-- transcript purge trigger"));
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    await client.query(trigger);
  } finally {
    await client.end();
  }
}

export async function teardown(): Promise<void> {
  // Release the run lock. The container itself is the user's
  // responsibility (it lives across test runs so they don't pay the
  // schema-push cost every time). To wipe state, restart the
  // container; to shut it down, run `docker compose -f
  // docker-compose.test.yml down`.
  if (lockClient) {
    await lockClient.end().catch(() => {});
    lockClient = null;
  }
}
