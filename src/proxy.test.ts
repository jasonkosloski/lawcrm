// @vitest-environment node
//
// The proxy is edge/server code, so node (undici) is the honest
// environment for it rather than the default happy-dom.

/**
 * Proxy (edge auth gate) tests.
 *
 * NextResponse.next({ request: { headers } }) encodes forwarded
 * request headers as `x-middleware-request-<name>` on the response
 * (plus `x-middleware-override-headers`) — that's the wire format
 * the Next runtime reads to rebuild the upstream request, so it's
 * the observable surface we assert against here.
 *
 * Clerk's middleware wrapper is replaced by a stand-in that calls our
 * handler with a controllable `auth()`; it also counts handler runs so
 * the portal-host tests can prove Clerk is never reached there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const clerk = vi.hoisted(() => ({
  userId: null as string | null,
  handlerCalls: 0,
  options: undefined as unknown,
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: vi.fn(
    (
      handler: (
        auth: () => Promise<{ userId: string | null }>,
        req: NextRequest,
        evt: NextFetchEvent,
      ) => unknown,
      options: unknown,
    ) => {
      clerk.options = options;
      return (req: NextRequest, evt: NextFetchEvent) => {
        clerk.handlerCalls++;
        return handler(async () => ({ userId: clerk.userId }), req, evt);
      };
    },
  ),
}));

import { config, isPortalHost, proxy as rawProxy } from "./proxy";
import { staffAuthorizedParties } from "@/lib/staff-authorized-parties";

const EVENT = {} as NextFetchEvent;
const proxy = async (req: NextRequest) => (await rawProxy(req, EVENT)) as Response;

beforeEach(() => {
  clerk.userId = null;
  clerk.handlerCalls = 0;
});

/** `signedIn: true` makes Clerk's auth() report a user. */
function makeRequest(url: string, init?: { signedIn?: boolean; headers?: Record<string, string> }) {
  if (init?.signedIn) clerk.userId = "user_clerk_1";
  return new NextRequest(new URL(url, "https://app.example.com"), {
    headers: new Headers(init?.headers),
  });
}

/** Forwarded request-header value, per the encoding described above. */
function forwardedHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy auth gate", () => {
  it("redirects signed-out requests to /login?next=<path+search>", async () => {
    const res = await proxy(makeRequest("/matters/42?tab=notes"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/matters/42?tab=notes");
  });

  it("encodes ?next= for a simple path", async () => {
    const res = await proxy(makeRequest("/matters"));
    expect(new URL(res.headers.get("location")!).search).toBe("?next=%2Fmatters");
  });

  it("omits ?next= when the target is the bare root", async () => {
    const res = await proxy(makeRequest("/"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.has("next")).toBe(false);
  });

  it.each(["/login", "/sso-callback", "/no-access", "/api/csp-report"])(
    "passes public route %s without a session",
    async (path) => {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(200);
      expect(res.headers.has("location")).toBe(false);
    },
  );

  it("passes the Clerk webhook without a session (it verifies its own signature)", async () => {
    const res = await proxy(makeRequest("/api/webhooks/clerk"));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  // Regression: Vercel Cron + Blob's upload-completed callback send no
  // session; redirecting them meant the jobs never ran and
  // client-direct uploads never created Document rows.
  it.each([
    "/api/email-sync",
    "/api/notification-sweep",
    "/api/matter-draft-sweep",
    "/api/documents/upload/blob",
  ])("passes self-authenticated machine endpoint %s through without a session", async (path) => {
    const res = await proxy(makeRequest(path, { headers: { authorization: "Bearer x" } }));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  it("lets CSP violation reports through (exact path only)", async () => {
    expect((await proxy(makeRequest("/api/csp-report"))).status).toBe(200);
    expect((await proxy(makeRequest("/api/csp-reports"))).status).toBe(307);
  });

  describe("/dev/sign-in-as (dev-only backdoor)", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("is public when dev-allowed", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("DEV_SIGN_IN", "1");
      vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5433/db");
      expect((await proxy(makeRequest("/dev/sign-in-as"))).status).toBe(200);
    });

    it.each([
      ["production", "pk_test_x", ""],
      ["development", "pk_live_x", ""],
      ["development", "pk_test_x", "1"],
    ])("stays behind the gate (%s, %s, VERCEL=%s)", async (ne, key, vercel) => {
      vi.stubEnv("NODE_ENV", ne);
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", key);
      vi.stubEnv("VERCEL", vercel);
      const res = await proxy(makeRequest("/dev/sign-in-as"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    });
  });

  it("keeps lookalike paths of machine endpoints behind the gate", async () => {
    for (const path of [
      "/api/email-sync-admin",
      "/api/documents/upload",
      "/api/webhooks/clerk-admin",
      "/api/webhooks",
    ]) {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(307);
    }
  });

  // F442: the public prefixes match on a path boundary, so a lookalike
  // can't ride the /login exemption.
  it.each(["/loginfoo", "/login-help", "/sso-callbackx", "/no-access-x"])(
    "keeps prefix lookalike %s behind the gate",
    async (path) => {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it.each(["/login", "/login/", "/login/factor-two"])(
    "still passes public route %s without a session",
    async (path) => {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(200);
      expect(res.headers.has("location")).toBe(false);
    },
  );

  it("Auth.js's /api/auth is no longer public", async () => {
    const res = await proxy(makeRequest("/api/auth/session"));
    expect(res.status).toBe(307);
  });

  it("passes signed-in requests through", async () => {
    const res = await proxy(makeRequest("/matters", { signedIn: true }));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  it("gives clerkMiddleware an authorizedParties option", () => {
    // Same helper the route-handler path (authenticateRequest) uses.
    const opts = clerk.options as (req: unknown) => { authorizedParties?: string[] };
    expect(typeof opts).toBe("function");
    vi.stubEnv("STAFF_ORIGINS", "https://crm.example.com");
    expect(opts(undefined).authorizedParties).toEqual(staffAuthorizedParties());
    expect(opts(undefined).authorizedParties).toContain("https://crm.example.com");
    vi.unstubAllEnvs();
  });
});

describe("x-pathname request-header injection", () => {
  it("forwards pathname + search to layouts on signed-in pass-through", async () => {
    const res = await proxy(makeRequest("/matters/42?tab=notes", { signedIn: true }));
    expect(forwardedHeader(res, "x-pathname")).toBe("/matters/42?tab=notes");
  });

  it("forwards it on public-route pass-through too", async () => {
    const res = await proxy(makeRequest("/login?next=%2Fmatters"));
    expect(forwardedHeader(res, "x-pathname")).toBe("/login?next=%2Fmatters");
  });

  it("overwrites a client-spoofed x-pathname (open-redirect guard)", async () => {
    const res = await proxy(
      makeRequest("/matters", {
        signedIn: true,
        headers: { "x-pathname": "https://evil.example.com/phish" },
      }),
    );
    expect(forwardedHeader(res, "x-pathname")).toBe("/matters");
  });

  it("sets it as a request header, not a client-visible response header", async () => {
    const res = await proxy(makeRequest("/matters", { signedIn: true }));
    expect(res.headers.get("x-pathname")).toBeNull();
  });
});

// F977: when a proxy runs, Next buffers the request body (10 MB
// default) and hands the handler a truncated copy — fatal for the
// streaming multi-GB upload route. The matcher must skip exactly that
// route and nothing broader.
describe("proxy matcher", () => {
  const source = config.matcher[0];
  // Next anchors matcher sources like this when it compiles them.
  const re = new RegExp(`^${source}$`);

  it.each(["/api/documents/upload", "/_next/static/chunks/a.js", "/favicon.ico"])(
    "does not run the proxy for %s",
    (path) => {
      expect(re.test(path)).toBe(false);
    },
  );

  it.each([
    "/",
    "/matters",
    "/api/documents/upload/blob",
    "/api/documents/upload-admin",
    "/api/documents/123/download",
    "/api/email-sync",
    "/login",
    "/logo.png",
    "/matters/x.js",
  ])("still runs the proxy for %s", (path) => {
    expect(re.test(path)).toBe(true);
  });
});

describe("proxy CSP nonce", () => {
  const CSP = "content-security-policy-report-only";

  it("gives each page request a fresh nonce, on both the request and the response", async () => {
    const a = await proxy(makeRequest("/matters", { signedIn: true }));
    const b = await proxy(makeRequest("/matters", { signedIn: true }));
    const policyA = a.headers.get(CSP)!;
    const nonceA = /'nonce-([^']+)'/.exec(policyA)![1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get(CSP)!)![1];
    expect(nonceA).not.toBe(nonceB);
    expect(nonceA.length).toBeGreaterThanOrEqual(24);
    // Next reads the nonce from the forwarded request header.
    expect(forwardedHeader(a, CSP)).toBe(policyA);
    expect(policyA).toContain("'strict-dynamic'");
    expect(policyA).toContain("frame-ancestors 'none'");
  });

  it("covers the public login page too", async () => {
    expect((await proxy(makeRequest("/login"))).headers.get(CSP)).toContain("'nonce-");
  });

  it("API routes get no page policy", async () => {
    const res = await proxy(makeRequest("/api/csp-report"));
    expect(res.headers.get(CSP)).toBeNull();
  });
});

describe("portal host routing", () => {
  beforeEach(() => {
    vi.stubEnv("PORTAL_HOST", "portal.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const portalReq = (path: string) =>
    new NextRequest(new URL(path, "https://portal.example.com"), {
      headers: new Headers({ host: "portal.example.com" }),
    });
  const rewriteOf = (res: Response) => new URL(res.headers.get("x-middleware-rewrite")!);

  it("isPortalHost strips the port and matches PORTAL_HOST", () => {
    expect(isPortalHost("portal.example.com")).toBe(true);
    expect(isPortalHost("portal.example.com:3000")).toBe(true);
    expect(isPortalHost("app.example.com")).toBe(false);
    expect(isPortalHost(null)).toBe(false);
  });

  it("portal.localhost is a portal host outside production only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isPortalHost("portal.localhost:3000")).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isPortalHost("portal.localhost:3000")).toBe(false);
  });

  it("portal host: / rewrites to /portal and carries the page CSP", async () => {
    const res = await proxy(portalReq("/"));
    expect(rewriteOf(res).pathname).toBe("/portal");
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toBeTruthy();
    expect(forwardedHeader(res, "content-security-policy-report-only")).toBe(csp);
    expect(forwardedHeader(res, "x-pathname")).toBe("/");
  });

  it("portal host: the Clerk middleware is never invoked", async () => {
    for (const p of ["/", "/login", "/matters/x.js", "/_next/webpack-hmr", "/api/csp-report"]) {
      await proxy(portalReq(p));
    }
    expect(clerk.handlerCalls).toBe(0);
  });

  it("portal host: /matters/abc rewrites to /portal/matters/abc", async () => {
    const res = await proxy(portalReq("/matters/abc?x=1"));
    const u = rewriteOf(res);
    expect(u.pathname).toBe("/portal/matters/abc");
    expect(u.search).toBe("?x=1");
  });

  it("portal host: staff paths are unreachable", async () => {
    for (const p of ["/settings", "/api/email-sync", "/intake/x"]) {
      const res = await proxy(portalReq(p));
      expect(rewriteOf(res).pathname.startsWith("/portal/")).toBe(true);
    }
  });

  it("portal host: /api/csp-report and /_next pass through", async () => {
    for (const p of ["/api/csp-report", "/_next/webpack-hmr"]) {
      const res = await proxy(portalReq(p));
      expect(res.headers.has("x-middleware-rewrite")).toBe(false);
    }
  });

  it("portal host: no staff session gate", async () => {
    const res = await proxy(portalReq("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
    expect(rewriteOf(res).pathname).toBe("/portal/login");
  });

  it("portal host: static-looking staff paths are still rewritten", async () => {
    const res = await proxy(portalReq("/matters/x.js"));
    expect(rewriteOf(res).pathname).toBe("/portal/matters/x.js");
  });

  it("staff host: static-looking paths pass through untouched", async () => {
    const res = await proxy(makeRequest("/foo.js"));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
    expect(res.headers.has("x-middleware-rewrite")).toBe(false);
    expect(clerk.handlerCalls).toBe(0);
  });

  it("isPortalHost ignores one trailing dot", () => {
    expect(isPortalHost("portal.example.com.")).toBe(true);
  });

  it("staff host: /portal and /portal/x return 404", async () => {
    expect((await proxy(makeRequest("/portal", { signedIn: true }))).status).toBe(404);
    expect((await proxy(makeRequest("/portal/x", { signedIn: true }))).status).toBe(404);
    expect((await proxy(makeRequest("/portalx", { signedIn: true }))).status).not.toBe(404);
  });

  // The portal's dev multipart route lives one level below the matcher-
  // excluded staff path, so the proxy runs and rewrites it on the portal
  // host (the excluded exact path would reach the staff route instead).
  it("portal host: /api/documents/upload/local rewrites to the portal route", async () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/documents/upload/local")).toBe(true);
    const res = await proxy(portalReq("/api/documents/upload/local"));
    expect(rewriteOf(res).pathname).toBe("/portal/api/documents/upload/local");
  });

  it("staff host: the portal upload route is unreachable", async () => {
    expect(
      (await proxy(makeRequest("/portal/api/documents/upload/local", { signedIn: true }))).status,
    ).toBe(404);
    const res = await proxy(makeRequest("/api/documents/upload/local", { signedIn: true }));
    expect(res.headers.has("x-middleware-rewrite")).toBe(false);
  });

  it("staff host: static-looking /portal paths also 404", async () => {
    expect((await proxy(makeRequest("/portal/x.js"))).status).toBe(404);
    expect((await proxy(makeRequest("/portal/matters/a.png"))).status).toBe(404);
  });
});
