/**
 * Safety rails for the destructive database tooling: `prisma/seed.ts`
 * (wipes every table) and `prisma migrate reset` (drops the database).
 * Pure + dependency-free so prisma.config.ts, the seed (run through
 * tsx) and the unit tests can all import it.
 *
 * Rule: refuse unless EVERY configured database URL points at
 * localhost / 127.0.0.1 / ::1, or the operator sets `ALLOW_SEED=1`
 * for a known dev database. Production-looking environments
 * (NODE_ENV / VERCEL_ENV = production) are refused even with the
 * override.
 */

export type SeedGuardResult = { ok: true } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type Env = Record<string, string | undefined>;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function checkDestructiveDbAllowed(env: Env): SeedGuardResult {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return {
      ok: false,
      reason:
        "NODE_ENV/VERCEL_ENV is 'production'. This tool deletes data and is never allowed there, even with ALLOW_SEED=1.",
    };
  }

  const urls = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["DIRECT_DATABASE_URL", env.DIRECT_DATABASE_URL],
  ].filter((e): e is [string, string] => !!e[1]);

  if (urls.length === 0) {
    return {
      ok: false,
      reason: "No DATABASE_URL is configured. Set it in .env before running this tool.",
    };
  }

  if (env.ALLOW_SEED === "1") return { ok: true };

  const remote: string[] = [];
  for (const [name, url] of urls) {
    const host = hostOf(url);
    if (host === null) {
      remote.push(`${name} (unparseable URL)`);
    } else if (!LOCAL_HOSTS.has(host)) {
      remote.push(`${name} (host "${host}")`);
    }
  }
  if (remote.length > 0) {
    return {
      ok: false,
      reason:
        `Refusing to run against a non-local database: ${remote.join(", ")}. ` +
        "This wipes every table. If this is a throwaway dev database you are " +
        "sure about, re-run with ALLOW_SEED=1.",
    };
  }
  return { ok: true };
}

/** True for the Prisma CLI invocations that destroy data: `migrate
 *  reset`, `db seed`, and anything passing `--force-reset`. Used by
 *  prisma.config.ts, which loads for every CLI command (including the
 *  `migrate deploy` the operator legitimately runs against production)
 *  and so must only guard these. */
export function isDestructivePrismaInvocation(argv: string[]): boolean {
  const args = argv.slice(2);
  if (args.includes("--force-reset")) return true;
  const i = args.indexOf("migrate");
  if (i !== -1 && args[i + 1] === "reset") return true;
  const j = args.indexOf("db");
  if (j !== -1 && args[j + 1] === "seed") return true;
  return false;
}
