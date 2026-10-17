#!/usr/bin/env node
/**
 * Migration drift check (ADR-016).
 *
 * The integration tests build their database with `prisma db push`, so
 * nothing in the normal test run notices a schema.prisma edit that has
 * no migration - until production (migrated by hand with
 * `prisma migrate deploy`) throws P2022 "column does not exist".
 *
 * This script proves the migration chain on its own:
 *   1. create a scratch database next to the test one,
 *   2. `prisma migrate deploy` every migration into it,
 *   3. `prisma migrate diff` the result against prisma/schema.prisma
 *      and fail (exit 2) on ANY difference,
 *   4. drop the scratch database, success or failure.
 *
 * It only ever touches a throwaway database created here, on the local
 * test Postgres (docker-compose.test.yml, or TEST_DATABASE_URL). The
 * pre-commit hook runs it when prisma/ is staged; run it by hand with
 * `npm run check:migrations`.
 */

import { spawnSync } from "node:child_process";
import pg from "pg";

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://lawcrm_test:lawcrm_test@localhost:5433/lawcrm_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(message, code = 1) {
  console.error(`check-migrations: ${message}`);
  process.exit(code);
}

const admin = new URL(ADMIN_URL);
if (!LOCAL_HOSTS.has(admin.hostname.toLowerCase())) {
  fail(`refusing to run against non-local host "${admin.hostname}".`);
}

const scratchName = `lawcrm_test_migcheck_${process.pid}`;
const scratch = new URL(ADMIN_URL);
scratch.pathname = `/${scratchName}`;
const scratchUrl = scratch.toString();

const env = {
  ...process.env,
  DATABASE_URL: scratchUrl,
  DIRECT_DATABASE_URL: scratchUrl,
};

function prisma(args) {
  return spawnSync("npx", ["prisma", ...args], { env, stdio: "inherit" });
}

let exitCode = 0;
const client = new pg.Client({ connectionString: ADMIN_URL });
let created = false;

async function dropScratch() {
  if (!created) return;
  created = false;
  await client
    .query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
    .catch((err) => console.error("check-migrations: drop failed:", err.message));
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    dropScratch().finally(() => process.exit(130));
  });
}

try {
  await client.connect();
  await client.query(`CREATE DATABASE "${scratchName}"`);
  created = true;

  const deploy = prisma(["migrate", "deploy"]);
  if (deploy.status !== 0) {
    console.error("check-migrations: `prisma migrate deploy` failed on an empty database.");
    exitCode = 1;
  } else {
    const diff = prisma([
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ]);
    if (diff.status === 2) {
      console.error(
        "\ncheck-migrations: prisma/migrations does not produce prisma/schema.prisma.\n" +
          "Create the missing migration (prisma migrate dev --create-only) and commit it."
      );
      exitCode = 2;
    } else if (diff.status !== 0) {
      console.error("check-migrations: `prisma migrate diff` failed.");
      exitCode = 1;
    } else {
      console.log("check-migrations: migrations match schema.prisma.");
    }
  }
} catch (err) {
  console.error(
    "check-migrations: could not use the test Postgres " +
      "(is `docker compose -f docker-compose.test.yml up -d` running?):",
    err.message
  );
  exitCode = 1;
} finally {
  await dropScratch();
  await client.end().catch(() => {});
}

process.exit(exitCode);
