/**
 * Rules for applying migrations from the production build (ADR-058).
 *
 * `scripts/vercel-build.ts` runs `prisma migrate deploy` before
 * `next build` on production builds only, so the schema is never
 * behind the code that goes live. That is only safe for expand-only
 * migrations: the previous deployment keeps serving while the build
 * runs, so anything that drops, renames or retypes what it reads
 * breaks production mid-build. Such migrations must carry an
 * `ALLOW_DESTRUCTIVE` file (the reason, in prose) in their folder,
 * written once the live code no longer depends on what they remove.
 *
 * Pure + dependency-free so the build script, the pre-commit check
 * (`scripts/check-destructive-migrations.ts`) and the unit tests share it.
 */

type Env = Record<string, string | undefined>;

export const ALLOW_DESTRUCTIVE_FILE = "ALLOW_DESTRUCTIVE";

/**
 * Production Vercel builds only. Preview builds have their own
 * DATABASE_URL today, but an unmerged branch must never migrate
 * production even if that changes; a local `NODE_ENV=production`
 * build never qualifies either (VERCEL is set only on Vercel).
 */
export function shouldMigrateOnBuild(env: Env): boolean {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}

/** Host of a connection string, for the build log; never the credentials. */
export function describeDbHost(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).hostname || "(no host)";
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * Blank out `-- line` and `/* block *\/` comments, keeping newlines so
 * reported line numbers still match the file.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

const DESTRUCTIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "DROP TABLE/COLUMN/SCHEMA/TYPE/VIEW", re: /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i },
  { label: "RENAME", re: /\bRENAME\b/i },
  { label: "column type change", re: /\bALTER\s+COLUMN\s+("[^"]+"|\S+)\s+(SET\s+DATA\s+)?TYPE\b/i },
  { label: "SET NOT NULL", re: /\bSET\s+NOT\s+NULL\b/i },
  { label: "DROP DEFAULT", re: /\bDROP\s+DEFAULT\b/i },
  { label: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { label: "DELETE FROM", re: /\bDELETE\s+FROM\b/i },
];

export type DestructiveFinding = { line: number; label: string; text: string };

/** Statements that can break the previous deployment or destroy data. */
export function findDestructiveStatements(sql: string): DestructiveFinding[] {
  const original = sql.split("\n");
  const findings: DestructiveFinding[] = [];
  stripSqlComments(sql)
    .split("\n")
    .forEach((line, i) => {
      for (const { label, re } of DESTRUCTIVE_PATTERNS) {
        if (re.test(line)) {
          findings.push({ line: i + 1, label, text: original[i].trim() });
        }
      }
    });
  return findings;
}

/** Migration folder names not yet applied, in apply (lexical) order. */
export function pendingMigrations(
  folders: readonly string[],
  applied: ReadonlySet<string>
): string[] {
  return folders.filter((name) => !applied.has(name)).sort();
}

export type MigrationSource = { name: string; sql: string; allowDestructive: boolean };
export type BlockedMigration = { name: string; findings: DestructiveFinding[] };

/** Destructive migrations without an ALLOW_DESTRUCTIVE file. */
export function blockedMigrations(migrations: readonly MigrationSource[]): BlockedMigration[] {
  return migrations
    .filter((m) => !m.allowDestructive)
    .map((m) => ({ name: m.name, findings: findDestructiveStatements(m.sql) }))
    .filter((b) => b.findings.length > 0);
}

export function formatBlocked(blocked: readonly BlockedMigration[]): string {
  return blocked
    .map(
      (b) =>
        `  ${b.name}\n` +
        b.findings.map((f) => `    line ${f.line} (${f.label}): ${f.text}`).join("\n")
    )
    .join("\n");
}
