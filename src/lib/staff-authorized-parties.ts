/**
 * The origins allowed as the `azp` (authorized party) claim of a Clerk
 * session token. Shared by `clerkMiddleware` (src/proxy.ts) and
 * `authenticateRequest` (staff-auth.ts) so both verify tokens the same
 * way. Pure env reads, no server-only imports, so the proxy can use it.
 *
 * Origins come from env the repo already relies on: the Vercel
 * production host, the per-deployment preview host, and `AUTH_URL`
 * (Auth.js's optional override, retained until the Auth.js removal).
 * `http://localhost:3000` is added outside production. Returns
 * `undefined` (Clerk skips the check) only when nothing is known.
 */
export function staffAuthorizedParties(): string[] | undefined {
  const origins = new Set<string>();
  const addHost = (host: string | undefined) => {
    if (host?.trim()) origins.add(`https://${host.trim()}`);
  };
  addHost(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  addHost(process.env.VERCEL_URL);
  const authUrl = process.env.AUTH_URL?.trim();
  if (authUrl) {
    try {
      origins.add(new URL(authUrl).origin);
    } catch {
      // malformed: ignore rather than widen or break auth
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
  }
  return origins.size > 0 ? [...origins] : undefined;
}
