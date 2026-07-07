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
import { proxy } from "./proxy";

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
