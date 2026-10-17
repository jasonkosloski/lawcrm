// @vitest-environment node
//
// The default happy-dom environment enforces the browser's
// forbidden-header list and silently drops `cookie` when building a
// Request, so `request.cookies` would always be empty. The proxy is
// edge/server code, so node (undici, which permits `cookie`) is the
// honest environment for it.

/**
 * Proxy (edge auth gate) tests.
 *
 * NextResponse.next({ request: { headers } }) encodes forwarded
 * request headers as `x-middleware-request-<name>` on the response
 * (plus `x-middleware-override-headers`) — that's the wire format
 * the Next runtime reads to rebuild the upstream request, so it's
 * the observable surface we assert against here.
 */

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const SESSION_COOKIE = "authjs.session-token=some-token";

function makeRequest(url: string, init?: { cookie?: string; headers?: Record<string, string> }) {
  const headers = new Headers(init?.headers);
  if (init?.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(url, "https://app.example.com"), { headers });
}

/** Forwarded request-header value, per the encoding described above. */
function forwardedHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy auth gate", () => {
  it("redirects unauthenticated requests to /login?next=<path+search>", () => {
    const res = proxy(makeRequest("/matters/42?tab=notes"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/matters/42?tab=notes");
  });

  it("omits ?next= when the target is the bare root", () => {
    const res = proxy(makeRequest("/"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.has("next")).toBe(false);
  });

  it("passes public routes through without a session", () => {
    const res = proxy(makeRequest("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  // Regression: Vercel Cron + Blob's upload-completed callback send no
  // session cookie; redirecting them meant the jobs never ran and
  // client-direct uploads never created Document rows.
  it.each([
    "/api/email-sync",
    "/api/notification-sweep",
    "/api/documents/upload/blob",
  ])("passes self-authenticated machine endpoint %s through without a cookie", (path) => {
    const res = proxy(
      makeRequest(path, { headers: { authorization: "Bearer x" } })
    );
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  it("keeps lookalike paths of machine endpoints behind the gate", () => {
    for (const path of ["/api/email-sync-admin", "/api/documents/upload"]) {
      const res = proxy(makeRequest(path));
      expect(res.status).toBe(307);
    }
  });

  // F442: the public prefixes match on a path boundary, so a lookalike
  // can't ride the /login or /api/auth exemptions.
  it.each(["/loginfoo", "/login-help", "/api/authz/keys", "/api/auth-export"])(
    "keeps prefix lookalike %s behind the gate",
    (path) => {
      const res = proxy(makeRequest(path));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    }
  );

  it.each([
    "/login",
    "/login/",
    "/login/reset",
    "/api/auth",
    "/api/auth/session",
    "/api/auth/callback/google",
  ])("still passes public route %s without a session", (path) => {
    const res = proxy(makeRequest(path));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });

  it("passes authenticated requests through", () => {
    const res = proxy(makeRequest("/matters", { cookie: SESSION_COOKIE }));
    expect(res.status).toBe(200);
    expect(res.headers.has("location")).toBe(false);
  });
});

describe("x-pathname request-header injection", () => {
  it("forwards pathname + search to layouts on authenticated pass-through", () => {
    const res = proxy(
      makeRequest("/matters/42?tab=notes", { cookie: SESSION_COOKIE })
    );
    expect(forwardedHeader(res, "x-pathname")).toBe("/matters/42?tab=notes");
  });

  it("forwards it on public-route pass-through too", () => {
    const res = proxy(makeRequest("/login?next=%2Fmatters"));
    expect(forwardedHeader(res, "x-pathname")).toBe("/login?next=%2Fmatters");
  });

  it("overwrites a client-spoofed x-pathname (open-redirect guard)", () => {
    const res = proxy(
      makeRequest("/matters", {
        cookie: SESSION_COOKIE,
        headers: { "x-pathname": "https://evil.example.com/phish" },
      })
    );
    expect(forwardedHeader(res, "x-pathname")).toBe("/matters");
  });

  it("sets it as a request header, not a client-visible response header", () => {
    const res = proxy(makeRequest("/matters", { cookie: SESSION_COOKIE }));
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

  it.each([
    "/api/documents/upload",
    "/_next/static/chunks/a.js",
    "/favicon.ico",
    "/logo.png",
  ])("does not run the proxy for %s", (path) => {
    expect(re.test(path)).toBe(false);
  });

  it.each([
    "/",
    "/matters",
    "/api/documents/upload/blob",
    "/api/documents/upload-admin",
    "/api/documents/123/download",
    "/api/email-sync",
    "/login",
  ])("still runs the proxy for %s", (path) => {
    expect(re.test(path)).toBe(true);
  });
});
