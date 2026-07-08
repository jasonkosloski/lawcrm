/**
 * Unit tests for the Google OAuth plumbing.
 *
 * Pinned here:
 *   - state round-trip + every CSRF rejection branch (tampered
 *     signature, foreign nonce, malformed input) — this IS the
 *     callback's forgery gate;
 *   - authorization-URL contents (scopes, offline access, forced
 *     consent — the refresh_token guarantee lives in these params);
 *   - redirect-URI derivation (request origin vs AUTH_URL) —
 *     hardcoding here would break every non-localhost deploy;
 *   - token-endpoint error mapping (invalid_grant surfaces as a
 *     typed code the gmail-client branches on) with fetch mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GMAIL_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  GoogleOAuthError,
  buildGoogleAuthUrl,
  createOAuthState,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  googleIntegrationConfigured,
  refreshGoogleAccessToken,
  resolveGoogleRedirectUri,
  revokeGoogleToken,
  verifyOAuthState,
} from "./oauth";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.AUTH_SECRET = "unit-test-auth-secret";
  delete process.env.AUTH_URL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

describe("googleIntegrationConfigured", () => {
  it("is true only when both env vars are set", () => {
    expect(googleIntegrationConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleIntegrationConfigured()).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = "x";
    delete process.env.GOOGLE_CLIENT_ID;
    expect(googleIntegrationConfigured()).toBe(false);
  });
});

describe("OAuth state (CSRF)", () => {
  it("round-trips: a freshly minted state verifies against its nonce", () => {
    const { state, nonce } = createOAuthState();
    expect(verifyOAuthState(state, nonce)).toBe(true);
  });

  it("mints a unique nonce per call", () => {
    expect(createOAuthState().nonce).not.toBe(createOAuthState().nonce);
  });

  it("rejects a tampered signature", () => {
    const { state, nonce } = createOAuthState();
    const [statePart, sig] = state.split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyOAuthState(`${statePart}.${flipped}`, nonce)).toBe(false);
  });

  it("rejects a valid state presented with a different browser's nonce", () => {
    const { state } = createOAuthState();
    const { nonce: otherNonce } = createOAuthState();
    expect(verifyOAuthState(state, otherNonce)).toBe(false);
  });

  it("rejects a state signed under a different AUTH_SECRET", () => {
    const { state, nonce } = createOAuthState();
    process.env.AUTH_SECRET = "rotated-secret";
    expect(verifyOAuthState(state, nonce)).toBe(false);
  });

  it("rejects malformed / missing input without throwing", () => {
    expect(verifyOAuthState(null, "nonce")).toBe(false);
    expect(verifyOAuthState("state-without-dot", "nonce")).toBe(false);
    expect(verifyOAuthState(".only-sig", "nonce")).toBe(false);
    expect(verifyOAuthState(createOAuthState().state, null)).toBe(false);
    expect(verifyOAuthState("", "")).toBe(false);
  });
});

describe("resolveGoogleRedirectUri", () => {
  it("derives from the request origin by default", () => {
    expect(
      resolveGoogleRedirectUri("https://app.example.com/api/anything?x=1")
    ).toBe("https://app.example.com/api/integrations/google/callback");
    expect(resolveGoogleRedirectUri("http://localhost:3000/foo")).toBe(
      "http://localhost:3000/api/integrations/google/callback"
    );
  });

  it("prefers AUTH_URL when set (behind-a-proxy deploys)", () => {
    process.env.AUTH_URL = "https://crm.kosloskilaw.com";
    expect(resolveGoogleRedirectUri("http://10.0.0.5:3000/internal")).toBe(
      "https://crm.kosloskilaw.com/api/integrations/google/callback"
    );
  });
});

describe("buildGoogleAuthUrl", () => {
  it("carries the full offline-consent parameter set", () => {
    const { state } = createOAuthState();
    const url = new URL(
      buildGoogleAuthUrl({
        redirectUri: "https://app.example.com/api/integrations/google/callback",
        state,
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("client_id")).toBe(
      "test-client-id.apps.googleusercontent.com"
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/integrations/google/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPES.join(" "));
    // The refresh_token guarantee: offline + forced consent.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe(state);
  });
});

describe("token endpoint calls (fetch mocked)", () => {
  it("exchangeCodeForTokens posts the code grant and returns the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "ya29.fresh",
          expires_in: 3599,
          refresh_token: "1//refresh",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens("auth-code", "https://x/cb");
    expect(tokens.access_token).toBe("ya29.fresh");
    expect(tokens.refresh_token).toBe("1//refresh");

    expect(fetchMock).toHaveBeenCalledWith(
      GOOGLE_TOKEN_ENDPOINT,
      expect.objectContaining({ method: "POST" })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://x/cb");
    expect(body.get("client_id")).toBe(
      "test-client-id.apps.googleusercontent.com"
    );
  });

  it("maps Google's error body to a typed code — message stays token-free", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been revoked.",
          }),
          { status: 400 }
        )
      )
    );
    const err = await refreshGoogleAccessToken("1//dead").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(err.status).toBe(400);
    expect(err.message).not.toContain("1//dead");
  });

  it("rejects a success response with a missing access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    );
    await expect(refreshGoogleAccessToken("1//rt")).rejects.toBeInstanceOf(
      GoogleOAuthError
    );
  });

  it("fetchGoogleUserInfo returns the email, null when absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "User@Gmail.com" }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: "123" })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchGoogleUserInfo("tok")).email).toBe("User@Gmail.com");
    expect((await fetchGoogleUserInfo("tok")).email).toBeNull();
    // Bearer auth, not a query param (tokens must stay out of URLs).
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      "Bearer tok"
    );
  });

  it("revokeGoogleToken is best-effort: false on failure, never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(revokeGoogleToken("tok")).resolves.toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    );
    await expect(revokeGoogleToken("tok")).resolves.toBe(true);
  });
});
