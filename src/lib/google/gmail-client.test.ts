/**
 * Tests for the Gmail client helper — the contract the sync + send
 * layers build on.
 *
 * Google endpoints are a URL-dispatching fetch mock; the DATABASE
 * IS REAL (test Postgres) because refresh persistence is the point:
 * rotated tokens must land encrypted at rest, and invalid_grant
 * must flip the account to the reconnect-required error state.
 *
 * Pinned:
 *   - envelope round-trip incl. the bare-token degradation;
 *   - fresh token → returned WITHOUT a refresh round-trip;
 *   - expired → refreshed, envelope + rotated refresh token
 *     persisted (ciphertext at rest);
 *   - invalid_grant → syncStatus "error" + syncError + GmailAuthError;
 *   - transient refresh failure → throws WITHOUT flipping status;
 *   - gmailFetch: auth header wiring, ONE refresh-and-retry on 401,
 *     non-401s untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { isEncryptedToken } from "@/lib/email-token-crypto";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { GOOGLE_TOKEN_ENDPOINT } from "./oauth";
import {
  GMAIL_API_BASE,
  GmailAuthError,
  getGmailAccessToken,
  gmailFetch,
  parseAccessTokenEnvelope,
  serializeAccessToken,
} from "./gmail-client";

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const savedEnv: Partial<Record<string, string | undefined>> = {};

let userId: string;

beforeEach(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

async function seedAccount(opts: {
  accessToken?: string | null;
  refreshToken?: string | null;
  syncStatus?: string;
}) {
  const account = await prisma.emailAccount.create({
    data: {
      userId,
      emailAddress: "me@gmail.com",
      accessToken: opts.accessToken ?? null,
      refreshToken: opts.refreshToken ?? null,
      syncStatus: opts.syncStatus ?? "connected",
    },
    select: { id: true },
  });
  return account.id;
}

const fresh = () => serializeAccessToken("ya29.fresh", 3599);
const expired = () => serializeAccessToken("ya29.expired", -60);

describe("access-token envelope", () => {
  it("round-trips token + expiry", () => {
    const now = 1_700_000_000_000;
    const stored = serializeAccessToken("ya29.x", 3599, now);
    expect(parseAccessTokenEnvelope(stored)).toEqual({
      token: "ya29.x",
      expiresAt: now + 3599 * 1000,
    });
  });

  it("degrades a bare non-envelope token to expiry-unknown (0)", () => {
    expect(parseAccessTokenEnvelope("ya29.bare")).toEqual({
      token: "ya29.bare",
      expiresAt: 0,
    });
  });

  it("returns null for null/empty/token-less JSON", () => {
    expect(parseAccessTokenEnvelope(null)).toBeNull();
    expect(parseAccessTokenEnvelope("")).toBeNull();
    expect(parseAccessTokenEnvelope(JSON.stringify({ expiresAt: 5 }))).toBeNull();
  });
});

describe("getGmailAccessToken", () => {
  it("returns a still-fresh stored token without calling Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const accountId = await seedAccount({
      accessToken: fresh(),
      refreshToken: "1//rt",
    });
    await expect(getGmailAccessToken(accountId)).resolves.toBe("ya29.fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the rotation encrypted at rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(GOOGLE_TOKEN_ENDPOINT);
        return new Response(
          JSON.stringify({
            access_token: "ya29.rotated",
            expires_in: 3599,
            refresh_token: "1//rotated-rt",
          }),
          { status: 200 }
        );
      })
    );
    const accountId = await seedAccount({
      accessToken: expired(),
      refreshToken: "1//rt",
    });

    await expect(getGmailAccessToken(accountId)).resolves.toBe("ya29.rotated");

    // Persisted (plaintext via the extension)...
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(parseAccessTokenEnvelope(row.accessToken)?.token).toBe(
      "ya29.rotated"
    );
    expect(row.refreshToken).toBe("1//rotated-rt");
    expect(row.syncStatus).toBe("connected"); // untouched on success

    // ...and ciphertext at rest.
    const [raw] = await prisma.$queryRaw<
      Array<{ accessToken: string; refreshToken: string }>
    >`SELECT "accessToken", "refreshToken" FROM email_accounts WHERE id = ${accountId}`;
    expect(isEncryptedToken(raw.accessToken)).toBe(true);
    expect(isEncryptedToken(raw.refreshToken)).toBe(true);
    expect(raw.accessToken).not.toContain("ya29.rotated");
  });

  it("keeps the proven refresh token when Google's refresh response omits one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "ya29.r2", expires_in: 3599 }),
          { status: 200 }
        )
      )
    );
    const accountId = await seedAccount({
      accessToken: expired(),
      refreshToken: "1//keep-me",
    });
    await getGmailAccessToken(accountId);
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.refreshToken).toBe("1//keep-me");
  });

  it("invalid_grant (revoked): marks the account error + syncError and throws GmailAuthError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        })
      )
    );
    const accountId = await seedAccount({
      accessToken: expired(),
      refreshToken: "1//revoked",
    });

    await expect(getGmailAccessToken(accountId)).rejects.toBeInstanceOf(
      GmailAuthError
    );
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("error");
    expect(row.syncError).toMatch(/reconnect/i);
  });

  it("transient refresh failure (5xx): throws WITHOUT flipping account status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream sad", { status: 503 }))
    );
    const accountId = await seedAccount({
      accessToken: expired(),
      refreshToken: "1//rt",
    });
    await expect(getGmailAccessToken(accountId)).rejects.toThrow();
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("connected");
    expect(row.syncError).toBeNull();
  });

  it("no refresh token (disconnected row): marks reconnect-required and throws", async () => {
    const accountId = await seedAccount({
      accessToken: null,
      refreshToken: null,
      syncStatus: "disconnected",
    });
    await expect(getGmailAccessToken(accountId)).rejects.toBeInstanceOf(
      GmailAuthError
    );
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("error");
  });

  it("unknown account id throws GmailAuthError", async () => {
    await expect(getGmailAccessToken("nope")).rejects.toBeInstanceOf(
      GmailAuthError
    );
  });
});

describe("gmailFetch", () => {
  it("hits gmail/v1 with the bearer token and passes init through", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `${GMAIL_API_BASE}/users/me/messages?maxResults=5`
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer ya29.fresh"
      );
      expect(init?.method).toBe("POST");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const accountId = await seedAccount({
      accessToken: fresh(),
      refreshToken: "1//rt",
    });
    const res = await gmailFetch(
      accountId,
      "users/me/messages?maxResults=5",
      { method: "POST" }
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once after a forced refresh on 401", async () => {
    const gmailCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === GOOGLE_TOKEN_ENDPOINT) {
          return new Response(
            JSON.stringify({ access_token: "ya29.after-401", expires_in: 3599 }),
            { status: 200 }
          );
        }
        const token = new Headers(init?.headers).get("authorization")!;
        gmailCalls.push(token);
        // First gmail call (stale-but-bookkept-fresh token) 401s;
        // the retry with the refreshed token succeeds.
        return token === "Bearer ya29.after-401"
          ? new Response("{}", { status: 200 })
          : new Response("{}", { status: 401 });
      })
    );
    const accountId = await seedAccount({
      accessToken: fresh(), // bookkept fresh, revoked server-side
      refreshToken: "1//rt",
    });

    const res = await gmailFetch(accountId, "/users/me/profile");
    expect(res.status).toBe(200);
    expect(gmailCalls).toEqual(["Bearer ya29.fresh", "Bearer ya29.after-401"]);
  });

  it("returns non-401 responses as-is with no retry (rate limits are the caller's policy)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const accountId = await seedAccount({
      accessToken: fresh(),
      refreshToken: "1//rt",
    });
    const res = await gmailFetch(accountId, "/users/me/messages");
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
