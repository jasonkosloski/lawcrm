/**
 * Edge proxy — optimistic auth gate.
 *
 * In Next.js 16, what was `middleware.ts` is now `proxy.ts`. Its job
 * here is the cheap "is there ANY session cookie?" check, redirecting
 * unauthenticated requests to /login before they hit a layout. The
 * real authoritative check happens in `getCurrentUserId()` (server
 * components / actions) so an attacker can't bypass auth by spoofing
 * the cookie name — they'd hit the redirect from `auth()` anyway.
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
 *   - Static assets (Next handles via the matcher exclusion below)
 */

import { NextResponse, type NextRequest } from "next/server";

/** Auth.js cookie name. The `__Secure-` prefix is added when running
 *  over HTTPS (production); dev uses the unprefixed name. We check
 *  both so this works in every environment without env detection. */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Server layouts can't see the request URL, so we forward
  // pathname + search as `x-pathname` (read by the dashboard layout to
  // build /login?next=…). Always SET — overwriting any client-sent
  // value — so the header can't be spoofed into an open-redirect vector.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname + request.nextUrl.search);
  const passThrough = () =>
    // `request.headers` (not top-level `headers`) — top-level would set
    // RESPONSE headers, leaking to clients instead of reaching layouts.
    NextResponse.next({ request: { headers: requestHeaders } });

  // Public routes always pass.
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
