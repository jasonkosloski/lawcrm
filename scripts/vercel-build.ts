/**
 * Vercel build entry (`buildCommand` in vercel.json), ADR-058.
 *
 * Production builds apply pending migrations BEFORE `next build`, so a
 * failed migration fails the build and the previous deployment keeps
 * serving; code never goes live ahead of its schema. Every other build
 * (preview, local) only builds. Destructive pending migrations without
 * an ALLOW_DESTRUCTIVE file stop the build instead of being applied.
 *
 * Run with: tsx scripts/vercel-build.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  ALLOW_DESTRUCTIVE_FILE,
  blockedMigrations,
  describeDbHost,
  formatBlocked,
  pendingMigrations,
  shouldMigrateOnBuild,
} from "../src/lib/migration-deploy-guard";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`vercel-build: \`${cmd} ${args.join(" ")}\` failed.`);
    process.exit(result.status ?? 1);
  }
}

function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(MIGRATIONS_DIR, d.name, "migration.sql")))
    .map((d) => d.name);
}

async function appliedMigrations(url: string): Promise<Set<string>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query<{ t: string | null }>(
      `SELECT to_regclass('public._prisma_migrations') AS t`
    );
    if (!exists.rows[0]?.t) return new Set();
    const rows = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    );
    return new Set(rows.rows.map((r) => r.migration_name));
  } finally {
    await client.end().catch(() => {});
  }
}

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("vercel-build: DATABASE_URL is not set for this production build.");
    process.exit(1);
  }
  console.log(`vercel-build: production build, migrating ${describeDbHost(url)}`);

  const pending = pendingMigrations(migrationFolders(), await appliedMigrations(url));
  if (pending.length === 0) {
    console.log("vercel-build: no pending migrations.");
    return;
  }
  console.log(`vercel-build: pending migrations:\n  ${pending.join("\n  ")}`);

  const blocked = blockedMigrations(
    pending.map((name) => ({
      name,
      sql: readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
      allowDestructive: existsSync(path.join(MIGRATIONS_DIR, name, ALLOW_DESTRUCTIVE_FILE)),
    }))
  );
  if (blocked.length > 0) {
    console.error(
      "vercel-build: refusing to auto-apply destructive migrations (ADR-058):\n" +
        formatBlocked(blocked) +
        `\nThe running deployment may still use what these remove. Once it no longer does, add an ` +
        `${ALLOW_DESTRUCTIVE_FILE} file (the reason) to the migration folder, or apply it by hand ` +
        "(docs/DEPLOY_BACKFILLS.md)."
    );
    process.exit(1);
  }

  // prisma.config.ts prefers DIRECT_DATABASE_URL; pin it to this build's
  // DATABASE_URL so nothing else (a stray .env) can redirect the migration.
  run("npx", ["prisma", "migrate", "deploy"], {
    ...process.env,
    DIRECT_DATABASE_URL: url,
  });
}

async function main() {
  if (shouldMigrateOnBuild(process.env)) {
    await migrate();
  } else {
    console.log(`vercel-build: ${process.env.VERCEL_ENV ?? "local"} build, skipping migrations.`);
  }
  run("npx", ["prisma", "generate"]);
  run("npx", ["next", "build"]);
}

main().catch((err) => {
  console.error("vercel-build: failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
