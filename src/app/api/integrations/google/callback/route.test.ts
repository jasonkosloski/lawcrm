// @vitest-environment node
//
// Node env (proxy.test.ts idiom): the CSRF check reads the `cookie`
// request header, which happy-dom's Request silently drops.

/**
 * Integration tests for the OAuth callback — the row-writing leg.
 *
 * Google's endpoints are a URL-dispatching fetch mock; auth is
 * mocked; the DATABASE IS REAL (test Postgres) because the point is
 * the EmailAccount row: upsert-by-(userId,emailAddress), the JSON
 * access-token envelope, and ciphertext at rest (asserted via raw
 * SQL, the email-token-encryption.test.ts idiom).
 *
 * Also pinned: every rejection path (state forgery, consent denial,
 * exchange failure) writes NO row and redirects with a machine code
 * only — no token material in the URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptedToken } from "@/lib/email-token-crypto";
import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  createOAuthState,
} from "@/lib/google/oauth";
import { parseAccessTokenEnvelope } from "@/lib/google/gmail-client";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { GET } from "./route";

const mockedAuth = vi.mocked(auth);

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET", "AUTH_URL"] as const;
const savedEnv: Partial<Record<string, string | undefined>> = {};

let userId: string;

/** URL-dispatching Google mock. Override per-test via `handlers`. */
function stubGoogle(handlers?: {
  token?: () => Response;
  userinfo?: () => Response;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      return (
        handlers?.token?.() ??
        new Response(
          JSON.stringify({
            access_token: "ya29.exchanged",
            expires_in: 3599,
            refresh_token: "1//refresh-token",
          }),
          { status: 200 }
        )
      );
    }
    if (url === GOOGLE_USERINFO_ENDPOINT) {
      return (
        handlers?.userinfo?.() ??
        new Response(JSON.stringify({ email: "Jason.K@gmail.com" }))
      );
    }
    throw new Error(`Unexpected fetch in callback test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeCallbackRequest(opts: {
  code?: string;
  state?: string;
  nonce?: string;
  error?: string;
}) {
  const url = new URL(
    "/api/integrations/google/callback",
    "https://app.example.com"
  );
  if (opts.code) url.searchParams.set("code", opts.code);
  if (opts.state) url.searchParams.set("state", opts.state);
  if (opts.error) url.searchParams.set("error", opts.error);
  const headers = new Headers();
  if (opts.nonce) headers.set("cookie", `google_oauth_state=${opts.nonce}`);
  return new NextRequest(url, { headers });
}

function settingsRedirect(res: Response) {
  const location = new URL(res.headers.get("location")!);
  expect(location.pathname).toBe("/settings/integrations");
  return location.searchParams;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  process.env.AUTH_SECRET = "callback-route-test-secret";
  delete process.env.AUTH_URL;

  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  mockedAuth.mockResolvedValue({
    user: { id: userId },
    expires: "",
  } as never);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/integrations/google/callback", () => {
  it("happy path: upserts the EmailAccount, tokens encrypted at rest, redirects ?connected=1", async () => {
    stubGoogle();
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "auth-code", state, nonce }));

    expect(settingsRedirect(res).get("connected")).toBe("1");
    // One-shot cookie cleared.
    expect(res.headers.get("set-cookie")).toContain("google_oauth_state=;");

    // App-facing row: plaintext envelope + connected status, address
    // normalized to lowercase.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: {
        userId_emailAddress: { userId, emailAddress: "jason.k@gmail.com" },
      },
    });
    expect(account.provider).toBe("gmail");
    expect(account.syncStatus).toBe("connected");
    expect(account.syncError).toBeNull();
    expect(account.refreshToken).toBe("1//refresh-token");
    const envelope = parseAccessTokenEnvelope(account.accessToken);
    expect(envelope?.token).toBe("ya29.exchanged");
    expect(envelope?.expiresAt).toBeGreaterThan(Date.now());

    // At-rest row: ciphertext, not the token or the envelope.
    const [raw] = await prisma.$queryRaw<
      Array<{ accessToken: string; refreshToken: string }>
    >`SELECT "accessToken", "refreshToken" FROM email_accounts WHERE id = ${account.id}`;
    expect(isEncryptedToken(raw.accessToken)).toBe(true);
    expect(isEncryptedToken(raw.refreshToken)).toBe(true);
    expect(raw.accessToken).not.toContain("ya29.exchanged");
  });

  it("reconnect: updates the existing row in place (no duplicate) and keeps the old refresh token when Google omits one", async () => {
    // Pre-existing account in error state with an old refresh token.
    const existing = await prisma.emailAccount.create({
      data: {
        userId,
        emailAddress: "jason.k@gmail.com",
        refreshToken: "1//old-refresh",
        syncStatus: "error",
        syncError: "Google authorization was revoked",
      },
    });

    stubGoogle({
      token: () =>
        new Response(
          // No refresh_token in the exchange (can happen despite
          // prompt=consent if Google collapses the re-grant).
          JSON.stringify({ access_token: "ya29.re", expires_in: 3599 }),
          { status: 200 }
        ),
    });
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "c", state, nonce }));
    expect(settingsRedirect(res).get("connected")).toBe("1");

    const rows = await prisma.emailAccount.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].syncStatus).toBe("connected");
    expect(rows[0].syncError).toBeNull();
    expect(rows[0].refreshToken).toBe("1//old-refresh"); // kept
    expect(parseAccessTokenEnvelope(rows[0].accessToken)?.token).toBe(
      "ya29.re"
    );
  });

  it("CSRF: rejects a state that doesn't match the browser nonce — no row, no token calls", async () => {
    const fetchMock = stubGoogle();
    const { state } = createOAuthState();
    const { nonce: foreignNonce } = createOAuthState();
    const res = await GET(
      makeCallbackRequest({ code: "c", state, nonce: foreignNonce })
    );
    expect(settingsRedirect(res).get("error")).toBe("state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.emailAccount.count()).toBe(0);
  });

  it("CSRF: rejects a missing nonce cookie and a tampered state", async () => {
    stubGoogle();
    const { state, nonce } = createOAuthState();
    // No cookie at all.
    let res = await GET(makeCallbackRequest({ code: "c", state }));
    expect(settingsRedirect(res).get("error")).toBe("state");
    // Tampered signature.
    res = await GET(
      makeCallbackRequest({ code: "c", state: `${state}x`, nonce })
    );
    expect(settingsRedirect(res).get("error")).toBe("state");
    expect(await prisma.emailAccount.count()).toBe(0);
  });

  it("maps consent denial to ?error=denied without calling Google", async () => {
    const fetchMock = stubGoogle();
    const res = await GET(makeCallbackRequest({ error: "access_denied" }));
    expect(settingsRedirect(res).get("error")).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an exchange failure to ?error=exchange with no token material in the URL", async () => {
    stubGoogle({
      token: () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
    });
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "bad", state, nonce }));
    const params = settingsRedirect(res);
    expect(params.get("error")).toBe("exchange");
    expect([...params.keys()]).toEqual(["error"]);
    expect(await prisma.emailAccount.count()).toBe(0);
  });

  it("maps a userinfo failure to ?error=userinfo and writes nothing", async () => {
    stubGoogle({
      userinfo: () => new Response("nope", { status: 500 }),
    });
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "c", state, nonce }));
    expect(settingsRedirect(res).get("error")).toBe("userinfo");
    expect(await prisma.emailAccount.count()).toBe(0);
  });

  it("refuses a FIRST connect that yields no refresh token (account would die at first expiry)", async () => {
    stubGoogle({
      token: () =>
        new Response(
          JSON.stringify({ access_token: "ya29.norefresh", expires_in: 3599 }),
          { status: 200 }
        ),
    });
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "c", state, nonce }));
    expect(settingsRedirect(res).get("error")).toBe("exchange");
    expect(await prisma.emailAccount.count()).toBe(0);
  });

  it("redirects to /login when the session died mid-flow", async () => {
    stubGoogle();
    mockedAuth.mockResolvedValue(null as never);
    const { state, nonce } = createOAuthState();
    const res = await GET(makeCallbackRequest({ code: "c", state, nonce }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
