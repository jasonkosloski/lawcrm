/**
 * Edge proxy — Clerk-backed optimistic sign-in gate (a UX redirect,
 * NOT the authority).
 *
 * In Next.js 16, what was `middleware.ts` is now `proxy.ts`. Staff
 * requests run through `clerkMiddleware`, which verifies the Clerk
 * session token cheaply (no DB) so unauthenticated requests redirect
 * to /login before rendering anything. Whether the Clerk user is an
 * actual firm member is NOT decided here: every page / action / route
 * handler resolves that through `getStaffAuth()` (src/lib/staff-auth.ts).
 *
 * The portal host never reaches Clerk: portal 404/rewrite/static
 * handling happens BEFORE the Clerk middleware is invoked, so portal
 * visitors never touch Clerk at all.
 *
 * Allowlist (PUBLIC_PATH_PREFIXES, path-boundary matched):
 *   - /login, /sso-callback — the Google sign-in flow
 *   - /no-access — signed in with Clerk but not a firm member
 *   - /dev/sign-in-as — dev-only impersonation, public only when
 *     isDevSignInAllowed() (src/lib/dev-sign-in.ts)
 *   - /api/csp-report — browsers post CSP violation reports without a
 *     reliable session (the login page reports too); it only logs
 *   - SELF_AUTHENTICATED_PATHS — cron, blob-callback and Clerk-webhook
 *     endpoints that carry their own credential instead of a session
 *   - /api/documents/upload is excluded by the matcher (see below); the
 *     route does its own session + permission check and answers JSON 401
 */

import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { CSP_HEADER, createNonce, pageCsp } from "@/lib/csp";
import { isDevSignInAllowed } from "@/lib/dev-sign-in";
import { isPortalHost } from "@/lib/portal/host";
import { staffAuthorizedParties } from "@/lib/staff-authorized-parties";

export { isPortalHost };

const STATIC_EXT = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/;

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/sso-callback",
  "/no-access",
  "/api/csp-report",
];

/**
 * Endpoints called by machines that never carry a session cookie —
 * redirecting them to /login means they silently never run. Each one
 * authenticates itself, so skipping the session check widens nothing:
 *   - cron endpoints require `Authorization: Bearer <CRON_SECRET>`
 *     (fail-closed when unset)
 *   - the blob upload route checks session + `documents.upload` when
 *     issuing tokens, and Vercel's completion callback is
 *     signature-verified by `handleUpload`
 *   - the Clerk webhook verifies its Svix signature
 * Exact matches only — a lookalike path stays behind the gate.
 */
const SELF_AUTHENTICATED_PATHS = new Set([
  "/api/email-sync",
  "/api/notification-sweep",
  "/api/matter-draft-sweep",
  "/api/documents/upload/blob",
  "/api/webhooks/clerk",
]);

/** Path-boundary-aware prefix match: `/login` and `/login/...` are
 *  public, `/loginfoo` is not (a bare `startsWith` would let it skip
 *  the session gate). */
function isPublicPath(pathname: string): boolean {
  // Dev-only sign-in-as page: public ONLY when dev-allowed (never in
  // production, with a live Clerk key, or on Vercel).
  if (
    (pathname === "/dev/sign-in-as" ||
      pathname.startsWith("/dev/sign-in-as/")) &&
    isDevSignInAllowed()
  ) {
    return true;
  }
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/** Page CSP for this request, or null for API routes (JSON/files; the
 *  framed file routes get theirs in next.config.ts). */
function cspFor(pathname: string): string | null {
  return pathname.startsWith("/api/")
    ? null
    : pageCsp(createNonce(), {
        isDev: process.env.NODE_ENV === "development",
        clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      });
}

/** Staff-host request handling, run inside Clerk's middleware. */
const staffProxy = clerkMiddleware(
  async (auth, request) => {
    const { pathname } = request.nextUrl;

    // Server layouts can't see the request URL, so we forward
    // pathname + search as `x-pathname` (read by the dashboard layout to
    // build /login?next=…). Always SET — overwriting any client-sent
    // value — so the header can't be spoofed into an open-redirect vector.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname + request.nextUrl.search);

    // Page CSP with a fresh nonce (src/lib/csp.ts). Next reads the nonce
    // from the REQUEST header and stamps its scripts/styles; the response
    // header is what the browser applies.
    const csp = cspFor(pathname);
    if (csp) requestHeaders.set(CSP_HEADER, csp);
    const passThrough = () => {
      // `request.headers` (not top-level `headers`) — top-level would set
      // RESPONSE headers, leaking to clients instead of reaching layouts.
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      if (csp) res.headers.set(CSP_HEADER, csp);
      return res;
    };

    // Public routes always pass.
    if (isPublicPath(pathname) || SELF_AUTHENTICATED_PATHS.has(pathname)) {
      return passThrough();
    }

    // Cheap check on Clerk's verified session token — no DB. Whether
    // the user is a firm member is decided by pages/actions.
    const { userId } = await auth();
    if (userId) return passThrough();

    // Bounce to /login with a `?next=` so we can land them back where
    // they were trying to go. Search params are preserved.
    const next = pathname + request.nextUrl.search;
    const loginUrl = new URL("/login", request.url);
    if (next && next !== "/") {
      loginUrl.searchParams.set("next", next);
    }
    const res = NextResponse.redirect(loginUrl);
    if (csp) res.headers.set(CSP_HEADER, csp);
    return res;
  },
  // Same origins `authenticateRequest` gets in staff-auth.ts.
  () => ({ authorizedParties: staffAuthorizedParties() })
);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const onPortalHost = isPortalHost(
    request.headers.get("host") ?? request.nextUrl.host
  );

  // Portal pages live under /portal internally and are served at /* on
  // the portal host only; on any other host they 404.
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

  // Portal host: no staff session gate and NO Clerk. Every path is
  // rewritten into /portal/*, where staff routes do not exist (so they
  // 404). Next internals and the CSP report endpoint pass through.
  if (onPortalHost) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname + request.nextUrl.search);
    const csp = cspFor(pathname);
    if (csp) requestHeaders.set(CSP_HEADER, csp);
    if (pathname.startsWith("/_next/") || pathname === "/api/csp-report") {
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      if (csp) res.headers.set(CSP_HEADER, csp);
      return res;
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

  return staffProxy(request, event);
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
  // itself (session 401 + `documents.upload` 403), so the Clerk gate
  // adds nothing; it does not read `x-pathname`.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/documents/upload$).*)",
  ],
};
