/**
 * Guards on the integration harness itself: the hand-maintained
 * delete list must cover every table, and resetDb must refuse to run
 * against anything but a local lawcrm_test* database.
 */

import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TABLES_IN_DELETE_ORDER, resetDb } from "./integration-helpers";
import { RUN_LOCK_KEY } from "./integration-setup";
import { baseTestDbUrl, dbNameOf } from "./test-db-config";

const savedUrl = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = savedUrl;
});

describe("TABLES_IN_DELETE_ORDER", () => {
  it("covers exactly the tables in the pushed schema", async () => {
    expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'`;
    const actual = rows.map((r) => r.table_name).sort();
    const listed = [...TABLES_IN_DELETE_ORDER].sort();
    // Missing from the list => rows leak between tests (or resetDb hits
    // an FK violation); extra in the list => DELETE of a missing table.
    expect(listed).toEqual(actual);
  });

  it("lists each table once", () => {
    expect(new Set(TABLES_IN_DELETE_ORDER).size).toBe(
      TABLES_IN_DELETE_ORDER.length
    );
  });
});

describe("run lock", () => {
  it("globalSetup holds the per-database advisory lock for the whole run", async () => {
    // A second run against this base database would block in
    // acquireRunLock() until this one finishes. The lock sits on the
    // `postgres` maintenance DB, keyed (RUN_LOCK_KEY, hashtext(base)).
    const base = dbNameOf(baseTestDbUrl());
    const rows = await prisma.$queryRaw<Array<{ held: number }>>`
      SELECT count(*)::int AS held FROM pg_locks
      WHERE locktype = 'advisory'
        AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = 'postgres')
        AND classid = ${RUN_LOCK_KEY}::oid
        AND objid = hashtext(${base})::oid
        AND objsubid = 2`;
    expect(rows[0].held).toBeGreaterThanOrEqual(1);
  });
});

describe("resetDb guard", () => {
  it("refuses a non-local DATABASE_URL before touching any table", async () => {
    process.env.DATABASE_URL =
      "postgresql://u:p@db.prisma.io:5432/lawcrm_prod";
    await expect(resetDb()).rejects.toThrow(/not localhost/);
  });

  it("refuses a local database that is not a test database", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/lawcrm_dev";
    await expect(resetDb()).rejects.toThrow(/lawcrm_test/);
  });

  it("runs against the test database", async () => {
    await expect(resetDb()).resolves.toBeUndefined();
  });
});

describe("connection pool", () => {
  it("lets two interactive transactions overlap on separate connections", async () => {
    // With the old `max: 1` pool the second transaction could not even
    // start until the first committed, so every "concurrent" billing /
    // team test ran serially and passed without its row lock. Each
    // transaction here waits for the other to have started; on a
    // single connection this would time out instead of resolving.
    let releaseA!: () => void;
    let releaseB!: () => void;
    const aStarted = new Promise<void>((r) => (releaseA = r));
    const bStarted = new Promise<void>((r) => (releaseB = r));
    const run = (mine: () => void, theirs: Promise<void>) =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          mine();
          await theirs;
          return true;
        },
        { maxWait: 5_000, timeout: 10_000 }
      );
    const results = await Promise.all([
      run(releaseA, bStarted),
      run(releaseB, aStarted),
    ]);
    expect(results).toEqual([true, true]);
  });
});
