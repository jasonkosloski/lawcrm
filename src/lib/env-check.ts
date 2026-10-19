/**
 * Startup environment check, run once per server instance from
 * `src/instrumentation.ts`.
 *
 * Each secret is otherwise read lazily where it is used, so a missing
 * one surfaced only as a runtime failure (crons 401-ing forever,
 * Gmail connect breaking on first use, uploads landing on Vercel's
 * ephemeral disk). Two levels:
 *   - fatal: the app cannot work at all without it — the instance
 *     refuses to start, so the deploy fails loudly.
 *   - degraded: one subsystem is dead without it — logged as an error
 *     on every cold start, app still serves.
 *
 * Only enforced on Vercel; local dev and tests read `.env` piecemeal.
 */

type Env = Record<string, string | undefined>;

export type EnvCheckResult = { fatal: string[]; degraded: string[] };

const set = (env: Env, key: string) => (env[key] ?? "").trim() !== "";

export function checkEnv(env: Env): EnvCheckResult {
  const fatal: string[] = [];
  const degraded: string[] = [];
  if (!set(env, "VERCEL")) return { fatal, degraded };

  for (const key of ["DATABASE_URL", "AUTH_SECRET", "BLOB_READ_WRITE_TOKEN"]) {
    if (!set(env, key)) fatal.push(key);
  }
  // Preview deployments legitimately run without crons or Gmail.
  if (env.VERCEL_ENV === "production") {
    if (!set(env, "CRON_SECRET")) {
      degraded.push("CRON_SECRET (email sync and deadline sweeps return 401)");
    }
    if (!set(env, "EMAIL_TOKEN_KEY")) {
      degraded.push("EMAIL_TOKEN_KEY (Gmail connect and sync fail)");
    }
    if (!set(env, "PORTAL_HOST")) {
      degraded.push("PORTAL_HOST (the client portal host is never routed)");
    }
    if (!set(env, "RESEND_API_KEY")) {
      degraded.push("RESEND_API_KEY (portal sign-in emails are not delivered)");
    }
    if (!set(env, "EMAIL_FROM")) {
      degraded.push("EMAIL_FROM (portal sign-in emails have no sender)");
    }
  }
  return { fatal, degraded };
}

/** Throws on fatal gaps; logs degraded ones. */
export function enforceEnv(env: Env = process.env): void {
  const { fatal, degraded } = checkEnv(env);
  for (const d of degraded) {
    console.error(`[env-check] missing ${d}`);
  }
  if (fatal.length > 0) {
    throw new Error(
      `[env-check] missing required environment variables: ${fatal.join(", ")}`
    );
  }
}
