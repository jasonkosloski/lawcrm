// @vitest-environment node
//
// Node env (proxy.test.ts idiom): happy-dom's Request drops the
// `cookie` header and its Response hides `set-cookie`; undici is
// the honest environment for route handlers.

/**
 * Tests for the OAuth connect leg. Pinned: the session gate, the
 * not-configured bounce, and the exact shape of the Google redirect
 * — authorization params + the nonce cookie (httpOnly, path-scoped,
 * short-lived) whose pairing with `state` is the CSRF gate the
 * callback tests exercise end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { verifyOAuthState } from "@/lib/google/oauth";
import { GET } from "./route";

const mockedAuth = vi.mocked(auth);

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET", "AUTH_URL"] as const;
const savedEnv: Partial<Record<string, string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  process.env.AUTH_SECRET = "connect-route-test-secret";
  delete process.env.AUTH_URL;
  mockedAuth.mockResolvedValue({
    user: { id: "user-1" },
    expires: "",
  } as never);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.clearAllMocks();
});

function makeRequest(origin = "https://app.example.com") {
  return new NextRequest(new URL("/api/integrations/google/connect", origin));
}

describe("GET /api/integrations/google/connect", () => {
  it("redirects unauthenticated requests to /login", async () => {
    mockedAuth.mockResolvedValue(null as never);
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("bounces to the settings error banner when env is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await GET(makeRequest());
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/settings/integrations");
    expect(location.searchParams.get("error")).toBe("not_configured");
  });

  it("redirects to Google with the offline-consent params and a redirect URI derived from the request origin", async () => {
    const res = await GET(makeRequest("https://firm.example.org"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://firm.example.org/api/integrations/google/callback"
    );
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/gmail.modify"
    );
    expect(location.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/gmail.send"
    );
  });

  it("prefers AUTH_URL for the redirect URI when set", async () => {
    process.env.AUTH_URL = "https://public.example.com";
    const res = await GET(makeRequest("http://internal-host:3000"));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://public.example.com/api/integrations/google/callback"
    );
  });

  it("sets the nonce cookie that verifies against the outgoing state", async () => {
    const res = await GET(makeRequest());
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("google_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/api/integrations/google");
    expect(setCookie).toContain("Max-Age=600");

    const nonce = /google_oauth_state=([^;]+)/.exec(setCookie)![1];
    const state = new URL(res.headers.get("location")!).searchParams.get(
      "state"
    );
    // The state Google will echo back verifies against this cookie —
    // the exact pair the callback checks.
    expect(verifyOAuthState(state, nonce)).toBe(true);
  });
});
