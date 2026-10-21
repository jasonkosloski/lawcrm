import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockedMigrations,
  describeDbHost,
  findDestructiveStatements,
  pendingMigrations,
  shouldMigrateOnBuild,
  stripSqlComments,
} from "./migration-deploy-guard";

describe("shouldMigrateOnBuild", () => {
  it("migrates only on Vercel production builds", () => {
    expect(shouldMigrateOnBuild({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
  });

  it.each([
    ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["development", { VERCEL: "1", VERCEL_ENV: "development" }],
    ["local NODE_ENV=production", { NODE_ENV: "production" }],
    ["VERCEL_ENV without VERCEL", { VERCEL_ENV: "production" }],
    ["empty", {}],
  ])("skips %s", (_label, env) => {
    expect(shouldMigrateOnBuild(env)).toBe(false);
  });
});

describe("describeDbHost", () => {
  it("returns the host without credentials", () => {
    expect(describeDbHost("postgres://user:secret@db.example.com:5432/app")).toBe("db.example.com");
  });

  it("labels missing and unparseable URLs", () => {
    expect(describeDbHost(undefined)).toBe("(unset)");
    expect(describeDbHost("<paste the Production URL>")).toBe("(unparseable URL)");
  });
});

describe("findDestructiveStatements", () => {
  it.each([
    [`ALTER TABLE "users" DROP COLUMN "password";`, "DROP TABLE/COLUMN/SCHEMA/TYPE/VIEW"],
    [`DROP TABLE "sessions";`, "DROP TABLE/COLUMN/SCHEMA/TYPE/VIEW"],
    [`DROP TYPE "Role_old";`, "DROP TABLE/COLUMN/SCHEMA/TYPE/VIEW"],
    [`ALTER TABLE "a" RENAME COLUMN "b" TO "c";`, "RENAME"],
    [`ALTER TABLE "inv" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);`, "column type change"],
    [`ALTER TABLE "inv" ALTER COLUMN amount TYPE TEXT;`, "column type change"],
    [`ALTER TABLE "m" ALTER COLUMN "x" SET NOT NULL;`, "SET NOT NULL"],
    [`ALTER TABLE "m" ALTER COLUMN "x" DROP DEFAULT;`, "DROP DEFAULT"],
    [`TRUNCATE "notes";`, "TRUNCATE"],
    [`DELETE FROM "notes" WHERE true;`, "DELETE FROM"],
  ])("flags %s", (sql, label) => {
    expect(findDestructiveStatements(sql).map((f) => f.label)).toContain(label);
  });

  it("passes add-only SQL", () => {
    const sql = [
      `CREATE TABLE "matter_drafts" ("id" TEXT NOT NULL, CONSTRAINT "matter_drafts_pkey" PRIMARY KEY ("id"));`,
      `ALTER TABLE "firms" ADD COLUMN "requireOriginatingDoc" BOOLEAN NOT NULL DEFAULT false;`,
      `CREATE INDEX "matter_drafts_createdById_idx" ON "matter_drafts"("createdById");`,
      `INSERT INTO "role_permissions" SELECT 1;`,
      `UPDATE "practice_areas" SET "x" = 1;`,
      `DROP INDEX "settlements_matterId_idx";`,
    ].join("\n");
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it("ignores comments and reports original line numbers", () => {
    const sql = [
      `-- we never DROP TABLE here, or TRUNCATE`,
      `/* ALTER COLUMN x TYPE text`,
      `   RENAME */`,
      `ALTER TABLE "u" DROP COLUMN "p"; -- RENAME later`,
    ].join("\n");
    expect(findDestructiveStatements(sql)).toEqual([
      {
        line: 4,
        label: "DROP TABLE/COLUMN/SCHEMA/TYPE/VIEW",
        text: `ALTER TABLE "u" DROP COLUMN "p"; -- RENAME later`,
      },
    ]);
  });

  it("keeps line count when stripping comments", () => {
    const sql = "a\n/* x\ny */\n-- z\nb";
    expect(stripSqlComments(sql).split("\n")).toHaveLength(5);
  });
});

describe("pendingMigrations", () => {
  it("returns unapplied folders in apply order", () => {
    const folders = ["20261020225241_b", "0_init", "20261020214030_a"];
    expect(pendingMigrations(folders, new Set(["0_init"]))).toEqual([
      "20261020214030_a",
      "20261020225241_b",
    ]);
  });

  it("treats every folder as pending on a fresh database", () => {
    expect(pendingMigrations(["0_init"], new Set())).toEqual(["0_init"]);
  });
});

describe("blockedMigrations", () => {
  const drop = `ALTER TABLE "u" DROP COLUMN "p";`;

  it("blocks destructive migrations without an ALLOW_DESTRUCTIVE file", () => {
    const blocked = blockedMigrations([
      { name: "a_add", sql: `ALTER TABLE "u" ADD COLUMN "q" TEXT;`, allowDestructive: false },
      { name: "b_drop", sql: drop, allowDestructive: false },
      { name: "c_drop_ok", sql: drop, allowDestructive: true },
    ]);
    expect(blocked.map((b) => b.name)).toEqual(["b_drop"]);
  });

  it("does not flag the add-only migrations that shipped on 2026-10-20", () => {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const names = readdirSync(dir).filter(
      (n) =>
        n.startsWith("20261020214030_venues") || n.startsWith("20261020225241_matter_drafts")
    );
    expect(names).toHaveLength(2);
    const blocked = blockedMigrations(
      names.map((name) => ({
        name,
        sql: readFileSync(path.join(dir, name, "migration.sql"), "utf8"),
        allowDestructive: false,
      }))
    );
    expect(blocked).toEqual([]);
  });
});
