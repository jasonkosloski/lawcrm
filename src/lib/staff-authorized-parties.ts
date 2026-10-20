/**
 * The origins allowed as the `azp` (authorized party) claim of a Clerk
 * session token. Shared by `clerkMiddleware` (src/proxy.ts) and
 * `authenticateRequest` (staff-auth.ts) so both verify tokens the same
 * way. Pure env reads, no server-only imports, so the proxy can use it.
 *
 * A wrong list signs everyone out (azp mismatch -> login loop), so:
 *   - `STAFF_ORIGINS` (comma-separated origins, e.g.
 *     `https://crm.example.com`) is authoritative when set.
 *   - Otherwise a heuristic from Vercel/Auth.js env: the branch URL,
 *     the deployment URL, the production URL and `AUTH_URL`, minus
 *     anything on `PORTAL_HOST` (VERCEL_PROJECT_PRODUCTION_URL is the
 *     shortest custom domain and can be the portal's).
 *   - `http://localhost:3000` is added outside production.
 *   - Never returns undefined/empty: Clerk treats both as "skip the azp
 *     check". An empty production list yields an impossible origin, so
 *     everything is rejected rather than silently unchecked.
 */

const NOTHING_CONFIGURED = "https://invalid.invalid";
let warned = false;

/** `value` as a bare origin (scheme + host[:port], no path), or null. */
function parseOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

const hostOf = (origin: string) => new URL(origin).hostname.toLowerCase();

export function staffAuthorizedParties(): string[] {
  const origins = new Set<string>();
  const explicit = (process.env.STAFF_ORIGINS ?? "").trim();

  if (explicit) {
    for (const part of explicit.split(",")) {
      const o = parseOrigin(part);
      if (o) origins.add(o);
    }
  } else {
    const portal = (process.env.PORTAL_HOST ?? "")
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, "");
    const candidates = [
      ["VERCEL_BRANCH_URL", true],
      ["VERCEL_URL", true],
      ["VERCEL_PROJECT_PRODUCTION_URL", true],
      ["AUTH_URL", false],
    ] as const;
    for (const [key, isHost] of candidates) {
      const raw = process.env[key]?.trim();
      if (!raw) continue;
      const o = parseOrigin(isHost ? `https://${raw}` : raw);
      if (o && !(portal && hostOf(o) === portal)) origins.add(o);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
  }
  if (origins.size === 0) {
    if (!warned) {
      warned = true;
      console.error(
        "[staff-auth] no staff origins configured (set STAFF_ORIGINS); rejecting all session tokens"
      );
    }
    return [NOTHING_CONFIGURED];
  }
  return [...origins];
}

/**
 * The staff app's public origin, for links Clerk emails out (invitation
 * redirect). First configured origin that isn't the localhost dev one;
 * outside production, localhost. Null when production has none
 * configured (callers must treat that as "can't build a link").
 */
export function staffAppUrl(): string | null {
  const real = staffAuthorizedParties().find(
    (o) => o !== NOTHING_CONFIGURED && !/^https?:\/\/localhost(:\d+)?$/.test(o)
  );
  if (real) return real;
  return process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null;
}
