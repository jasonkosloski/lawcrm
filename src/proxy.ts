/**
 * Edge proxy — optimistic cookie-presence gate (a UX redirect, NOT
 * the authority).
 *
 * In Next.js 16, what was `middleware.ts` is now `proxy.ts`. Its job
 * here is the cheap "is there ANY session cookie?" check, redirecting
 * unauthenticated requests to /login before they render anything. The
 * real check happens in every page / action / route handler
 * (`requireUser()` / `getCurrentUserId()` / `requirePermission`) —
 * pages authenticate themselves — so an attacker can't bypass auth by
 * spoofing the cookie name: they'd hit the redirect from `auth()`
 * anyway.
 *
 * Per the Next.js auth guide we deliberately do NOT validate the JWT
 * here:
 *   - Decoding requires the AUTH_SECRET in the proxy bundle, which
 *     widens the trusted boundary.
 *   - Adds DB-shaped overhead to every request.
 *   - Auth.js explicitly recommends optimistic checks here, real
 *     checks in pages/actions.
 *
 * Allowlist:
 *   - /login — the form itself
 *   - /api/auth/* — Auth.js handlers (sign-in callbacks, CSRF, etc.)
 *   - SELF_AUTHENTICATED_PATHS — cron + blob-callback endpoints that
 *     carry their own credential instead of a cookie
 *   - Static assets (Next handles via the matcher exclusion below)
 *   - /api/csp-report — browsers post CSP violation reports without
 *     a reliable cookie (the login page reports too); it only logs
 *   - /api/documents/upload is excluded by the matcher (see below); the
 *     route does its own session + permission check and answers JSON 401
 */

import { NextResponse, type NextRequest } from "next/server";
import { CSP_HEADER, createNonce, pageCsp } from "@/lib/csp";
import { isPortalHost } from "@/lib/portal/host";

export { isPortalHost };

const STATIC_EXT = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/;

/** Auth.js cookie name. The `__Secure-` prefix is added when running
 *  over HTTPS (production); dev uses the unprefixed name. We check
 *  both so this works in every environment without env detection. */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth", "/api/csp-report"];

/**
 * Endpoints called by machines that never carry a session cookie —
 * redirecting them to /login means they silently never run. Each one
 * authenticates itself, so skipping the cookie check widens nothing:
 *   - cron endpoints require `Authorization: Bearer <CRON_SECRET>`
 *     (fail-closed when unset)
 *   - the blob upload route checks session + `documents.upload` when
 *     issuing tokens, and Vercel's completion callback is
 *     signature-verified by `handleUpload`
 * Exact matches only — a lookalike path stays behind the gate.
 */
const SELF_AUTHENTICATED_PATHS = new Set([
  "/api/email-sync",
  "/api/notification-sweep",
  "/api/documents/upload/blob",
]);

/** Path-boundary-aware prefix match: `/login` and `/login/...` are
 *  public, `/loginfoo` and a future `/api/authz/*` or `/api/auth-export`
 *  are not (a bare `startsWith` would let them skip the cookie gate). */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const onPortalHost = isPortalHost(
    request.headers.get("host") ?? request.nextUrl.host
  );

  // Portal pages live under /portal internally live under /portal internally and are
  // served at /* on the portal host only; on any other host they 404.
  // Checked BEFORE the static-extension skip so /portal/x.js 404s too.
  if (
    !onPortalHost &&
    (pathname === "/portal" || pathname.startsWith("/portal/"))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // The matcher no longer skips static-looking paths (on the portal
  // host they must still be rewritten into /portal), so the staff host
  // skips them here, exactly as the matcher used to.
  if (!onPortalHost && STATIC_EXT.test(pathname)) {
    return NextResponse.next();
  }

  // Server layouts can't see the request URL, so we forward
  // pathname + search as `x-pathname` (read by the dashboard layout to
  // build /login?next=…). Always SET — overwriting any client-sent
  // value — so the header can't be spoofed into an open-redirect vector.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname + request.nextUrl.search);

  // Page CSP with a fresh nonce (src/lib/csp.ts). Next reads the nonce
  // from the REQUEST header and stamps its scripts/styles; the response
  // header is what the browser applies. API routes return JSON or files
  // and get none here (the framed file routes get theirs in
  // next.config.ts).
  const csp = pathname.startsWith("/api/")
    ? null
    : pageCsp(createNonce(), { isDev: process.env.NODE_ENV === "development" });
  if (csp) requestHeaders.set(CSP_HEADER, csp);
  const passThrough = () => {
    // `request.headers` (not top-level `headers`) — top-level would set
    // RESPONSE headers, leaking to clients instead of reaching layouts.
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    if (csp) res.headers.set(CSP_HEADER, csp);
    return res;
  };

  // Portal host: no staff cookie gate. Every path is rewritten into
  // /portal/*, where staff routes do not exist (so they 404). Next
  // internals and the CSP report endpoint pass through untouched.
  if (onPortalHost) {
    if (pathname.startsWith("/_next/") || pathname === "/api/csp-report") {
      return passThrough();
    }
    const target = new URL(
      "/portal" + (pathname === "/" ? "" : pathname) + request.nextUrl.search,
      request.url
    );
    const res = NextResponse.rewrite(target, {
      request: { headers: requestHeaders },
    });
    if (csp) res.headers.set(CSP_HEADER, csp);
    return res;
  }

  // Public routes always pass.
  if (isPublicPath(pathname) || SELF_AUTHENTICATED_PATHS.has(pathname)) {
    return passThrough();
  }

  // Cheap presence check — never reads or validates the JWT itself.
  const hasSession = SESSION_COOKIE_NAMES.some((name) =>
    request.cookies.has(name)
  );
  if (hasSession) {
    return passThrough();
  }

  // Bounce to /login with a `?next=` so we can land them back where
  // they were trying to go. Search params are preserved.
  const next = pathname + request.nextUrl.search;
  const loginUrl = new URL("/login", request.url);
  if (next && next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every request EXCEPT static assets and Next internals.
  // Path-based exclusion (regex negative lookahead) is the canonical
  // pattern from the Next.js docs.
  //
  // `api/documents/upload$` (exact — NOT /upload/blob, which stays
  // matched) is also excluded: when a proxy runs, Next clones and
  // buffers the request body, capped at 10 MB by default
  // (`proxyClientMaxBodySize`), and only the truncated body reaches the
  // handler. That route streams multi-GB multipart uploads through
  // busboy and would silently store corrupt files. It authenticates
  // itself (session 401 + `documents.upload` 403), so the cookie gate
  // adds nothing; it does not read `x-pathname`.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/documents/upload$).*)",
  ],
};
