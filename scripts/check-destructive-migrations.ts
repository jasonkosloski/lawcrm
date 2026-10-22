/**
 * Pre-commit check (ADR-058): a destructive migration is caught when
 * it is committed, not when the production build refuses it.
 *
 * Usage: tsx scripts/check-destructive-migrations.ts <migration.sql>...
 * The hook passes the staged prisma/migrations/<name>/migration.sql files.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ALLOW_DESTRUCTIVE_FILE,
  blockedMigrations,
  formatBlocked,
} from "../src/lib/migration-deploy-guard";

const files = process.argv.slice(2).filter((f) => f.endsWith("migration.sql"));

const blocked = blockedMigrations(
  files.map((file) => ({
    name: path.basename(path.dirname(file)),
    sql: readFileSync(file, "utf8"),
    allowDestructive: existsSync(path.join(path.dirname(file), ALLOW_DESTRUCTIVE_FILE)),
  })),
);

if (blocked.length > 0) {
  console.error(
    "check-destructive-migrations: the production build will refuse these (ADR-058):\n" +
      formatBlocked(blocked) +
      "\nSplit it expand/contract: ship code that no longer reads what is removed first, then\n" +
      `add an ${ALLOW_DESTRUCTIVE_FILE} file (the reason) to the migration folder.`,
  );
  process.exit(1);
}
