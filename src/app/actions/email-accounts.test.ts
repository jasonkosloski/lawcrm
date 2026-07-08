/**
 * Integration tests for `disconnectEmailAccount`.
 *
 * Real test Postgres; current-user + revalidatePath mocked
 * (matter-pins idiom); Google's revoke endpoint is a fetch mock.
 *
 * Pinned:
 *   - OWNER-ONLY: another user (even one who guessed the id) gets
 *     "not found" and the row — tokens included — is untouched;
 *   - cleanup contract: tokens null, syncStatus "disconnected",
 *     syncError cleared, threads KEPT (firm records);
 *   - revocation is best-effort: called with a token, but a Google
 *     failure never blocks the local disconnect.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { GOOGLE_REVOKE_ENDPOINT } from "@/lib/google/oauth";
import { serializeAccessToken } from "@/lib/google/gmail-client";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { disconnectEmailAccount } from "./email-accounts";

const mockedGetUser = vi.mocked(getCurrentUserId);

let ownerId: string;
let otherUserId: string;
let accountId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId: ownerId } = await seedUser({ firmId, email: "owner@example.com" }));
  ({ userId: otherUserId } = await seedUser({
    firmId,
    email: "other@example.com",
  }));

  const account = await prisma.emailAccount.create({
    data: {
      userId: ownerId,
      emailAddress: "owner@gmail.com",
      accessToken: serializeAccessToken("ya29.live", 3599),
      refreshToken: "1//refresh",
      syncStatus: "connected",
      syncError: "stale error from an old sync",
    },
    select: { id: true },
  });
  accountId = account.id;
  await prisma.emailThread.create({
    data: {
      accountId,
      subject: "Filed thread — firm record",
      lastMessageAt: new Date(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubRevoke(response: () => Promise<Response>) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      expect(String(input)).toBe(GOOGLE_REVOKE_ENDPOINT);
      return response();
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("disconnectEmailAccount", () => {
  it("owner: revokes at Google, clears tokens, keeps threads", async () => {
    mockedGetUser.mockResolvedValue(ownerId);
    const fetchMock = stubRevoke(async () => new Response("", { status: 200 }));

    const result = await disconnectEmailAccount(accountId);
    expect(result).toEqual({ ok: true });

    // Revoked the refresh token (kills the whole grant).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get("token")).toBe("1//refresh");

    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.accessToken).toBeNull();
    expect(row.refreshToken).toBeNull();
    expect(row.syncStatus).toBe("disconnected");
    expect(row.syncError).toBeNull();

    // Tokens null AT REST too, not just through the decrypting read.
    const [raw] = await prisma.$queryRaw<
      Array<{ accessToken: string | null; refreshToken: string | null }>
    >`SELECT "accessToken", "refreshToken" FROM email_accounts WHERE id = ${accountId}`;
    expect(raw.accessToken).toBeNull();
    expect(raw.refreshToken).toBeNull();

    // Threads are firm records — they survive the disconnect.
    expect(await prisma.emailThread.count({ where: { accountId } })).toBe(1);
  });

  it("non-owner: 'not found', row untouched — even for a firm colleague", async () => {
    mockedGetUser.mockResolvedValue(otherUserId);
    const fetchMock = stubRevoke(async () => new Response("", { status: 200 }));

    const result = await disconnectEmailAccount(accountId);
    expect(result).toEqual({ ok: false, error: "Email account not found." });
    expect(fetchMock).not.toHaveBeenCalled();

    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("connected");
    expect(row.refreshToken).toBe("1//refresh");
  });

  it("revocation failure (Google down) still disconnects locally", async () => {
    mockedGetUser.mockResolvedValue(ownerId);
    stubRevoke(async () => {
      throw new Error("google is down");
    });

    const result = await disconnectEmailAccount(accountId);
    expect(result).toEqual({ ok: true });
    const row = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(row.syncStatus).toBe("disconnected");
    expect(row.refreshToken).toBeNull();
  });

  it("falls back to revoking the access token when no refresh token is stored", async () => {
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { refreshToken: null },
    });
    mockedGetUser.mockResolvedValue(ownerId);
    const fetchMock = stubRevoke(async () => new Response("", { status: 200 }));

    await disconnectEmailAccount(accountId);
    const body = fetchMock.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get("token")).toBe("ya29.live"); // unwrapped from the envelope
  });
});
