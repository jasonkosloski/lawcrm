/**
 * Integration tests for the Gmail writeback module.
 *
 * `gmailFetch` is mocked (the contract seam with gmail-client); the
 * DB is real because the account-side effects ARE the contract:
 *
 *   - `modifyGmailThread` builds the exact modify payload (empty
 *     arrays omitted, empty modification = no network call);
 *   - `writebackGmailThread` NEVER rejects: auth errors record the
 *     reconnect signal on the account, transients console.warn and
 *     leave the account untouched, disconnected accounts (no
 *     refresh token) skip without hitting Google at all.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...mod, gmailFetch: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import {
  GmailWritebackError,
  modifyGmailThread,
  writebackGmailThread,
} from "./gmail-writeback";

const mockedFetch = vi.mocked(gmailFetch);

let userId: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDb();
  mockedFetch.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
});

afterEach(() => {
  warnSpy.mockRestore();
});

async function seedAccount(opts?: {
  refreshToken?: string | null;
  syncStatus?: string;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId,
      emailAddress: "me@gmail.com",
      refreshToken:
        opts?.refreshToken === undefined ? "rt-secret" : opts.refreshToken,
      syncStatus: opts?.syncStatus ?? "connected",
    },
    select: { id: true },
  });
  return account.id;
}

const ok = () => new Response("{}", { status: 200 });

describe("modifyGmailThread", () => {
  test("POSTs the modify payload to the thread endpoint", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValue(ok());

    await modifyGmailThread(accountId, "t-123", {
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [calledAccountId, path, init] = mockedFetch.mock.calls[0];
    expect(calledAccountId).toBe(accountId);
    expect(path).toBe("/users/me/threads/t-123/modify");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });
  });

  test("omits empty label arrays from the payload", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValue(ok());

    await modifyGmailThread(accountId, "t-123", {
      removeLabelIds: ["INBOX"],
      addLabelIds: [],
    });

    expect(JSON.parse(String(mockedFetch.mock.calls[0][2]?.body))).toEqual({
      removeLabelIds: ["INBOX"],
    });
  });

  test("an empty modification never hits the network", async () => {
    const accountId = await seedAccount();
    await modifyGmailThread(accountId, "t-123", {});
    await modifyGmailThread(accountId, "t-123", {
      addLabelIds: [],
      removeLabelIds: [],
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  test("throws GmailWritebackError on a non-2xx response", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(
      modifyGmailThread(accountId, "t-123", { removeLabelIds: ["UNREAD"] })
    ).rejects.toThrow(GmailWritebackError);
  });
});

describe("writebackGmailThread — fire-and-forget contract", () => {
  test("happy path modifies the thread and leaves the account clean", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValue(ok());

    await writebackGmailThread(accountId, "t-9", {
      removeLabelIds: ["UNREAD"],
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncError).toBeNull();
    expect(account.syncStatus).toBe("connected");
  });

  test("skips silently when the account has no refresh token (disconnected)", async () => {
    const accountId = await seedAccount({
      refreshToken: null,
      syncStatus: "disconnected",
    });

    await writebackGmailThread(accountId, "t-9", {
      removeLabelIds: ["UNREAD"],
    });

    expect(mockedFetch).not.toHaveBeenCalled();
    // Crucially the account was NOT flipped to reconnect-required.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("disconnected");
    expect(account.syncError).toBeNull();
  });

  test("GmailAuthError → reconnect signal recorded on the account, no throw", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockRejectedValue(
      new GmailAuthError("Reconnect this mailbox.", accountId)
    );

    await expect(
      writebackGmailThread(accountId, "t-9", { addLabelIds: ["STARRED"] })
    ).resolves.toBeUndefined();

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.syncError).toBe("Reconnect this mailbox.");
  });

  test("transient HTTP failure → console.warn, account untouched, no throw", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValue(new Response("{}", { status: 429 }));

    await expect(
      writebackGmailThread(accountId, "t-9", { removeLabelIds: ["INBOX"] })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
    expect(account.syncError).toBeNull();
  });

  test("network-level rejection is swallowed with a warn", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockRejectedValue(new Error("socket hang up"));

    await expect(
      writebackGmailThread(accountId, "t-9", { removeLabelIds: ["UNREAD"] })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
