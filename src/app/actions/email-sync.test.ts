/**
 * Integration tests for the user-triggered email sync action.
 *
 * Pins the auth posture (session-only, identity-scoped — the action
 * syncs the CURRENT user's mailboxes and can't be pointed at anyone
 * else's), the revalidation contract, and the piggybacked Google
 * Calendar pull (scoped accounts get a calendar pass off the same
 * "Sync now" trigger; a calendar failure never blocks the mail
 * results). The sync engines themselves are exercised through
 * their own suites; here `gmailFetch` is a minimal fake and the DB
 * is real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...mod, gmailFetch: vi.fn() };
});

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { gmailFetch } from "@/lib/google/gmail-client";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import { backfillMyEmailAccount, syncMyEmailAccounts } from "./email-sync";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedFetch = vi.mocked(gmailFetch);

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  ({ userId: otherUserId } = await seedUser({
    firmId,
    email: "other@kosloskilaw.com",
  }));
  mockedGetUser.mockResolvedValue(userId);

  // Minimal healthy Gmail: empty label list / thread list, a cursor.
  mockedFetch.mockImplementation(async (_accountId, path) => {
    const body = path.includes("/labels")
      ? { labels: [] }
      : path.includes("/profile")
        ? { historyId: "h1" }
        : { threads: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});

async function seedAccount(
  ownerId: string,
  email: string,
  opts?: { grantedScopes?: string }
): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: ownerId,
      emailAddress: email,
      refreshToken: "rt",
      syncStatus: "connected",
      grantedScopes: opts?.grantedScopes ?? null,
    },
    select: { id: true },
  });
  return account.id;
}

const CALENDAR_SCOPES =
  "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events";

describe("syncMyEmailAccounts", () => {
  it("syncs the current user's accounts only and revalidates", async () => {
    const mine = await seedAccount(userId, "me@gmail.com");
    await seedAccount(otherUserId, "other@gmail.com");

    const res = await syncMyEmailAccounts();
    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ accountId: mine, ok: true });

    // Only my account ever hit Google.
    expect(
      mockedFetch.mock.calls.every(([accountId]) => accountId === mine)
    ).toBe(true);
    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
    expect(mockedRevalidate).toHaveBeenCalledWith("/settings/integrations");

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: mine },
    });
    expect(account.lastSyncAt).not.toBeNull();
    expect(account.historyId).toBe("h1");
  });

  it("returns empty results (ok, no revalidation) when nothing is connected", async () => {
    const res = await syncMyEmailAccounts();
    expect(res).toEqual({ ok: true, results: [], calendar: [] });
    expect(mockedRevalidate).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("also pulls Google Calendar for calendar-scoped accounts (Sync now covers calendar)", async () => {
    const mine = await seedAccount(userId, "me@gmail.com", {
      grantedScopes: CALENDAR_SCOPES,
    });
    mockedFetch.mockImplementation(async (_accountId, path) => {
      if (path.startsWith("https://www.googleapis.com/calendar/v3/")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "g-1",
                status: "confirmed",
                summary: "Google-born",
                start: { dateTime: "2026-08-01T15:00:00.000Z" },
                end: { dateTime: "2026-08-01T16:00:00.000Z" },
                updated: "2026-07-01T00:00:00.000Z",
              },
            ],
            nextSyncToken: "st-1",
          }),
          { status: 200 }
        );
      }
      const body = path.includes("/labels")
        ? { labels: [] }
        : path.includes("/profile")
          ? { historyId: "h1" }
          : { threads: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const res = await syncMyEmailAccounts();
    expect(res.ok).toBe(true);
    expect(res.calendar).toHaveLength(1);
    expect(res.calendar[0]).toMatchObject({
      accountId: mine,
      ok: true,
      imported: 1,
    });
    expect(
      await prisma.calendarEvent.count({ where: { title: "Google-born" } })
    ).toBe(1);
    expect(mockedRevalidate).toHaveBeenCalledWith("/calendar");
  });

  it("unscoped accounts skip calendar cleanly — no /calendar revalidation", async () => {
    await seedAccount(userId, "me@gmail.com"); // no calendar scope
    const res = await syncMyEmailAccounts();
    expect(res.ok).toBe(true);
    expect(res.calendar[0]).toMatchObject({ ok: true, mode: "skipped" });
    expect(mockedRevalidate).not.toHaveBeenCalledWith("/calendar");
  });

  it("a calendar failure never blocks the mail results (ok stays the email verdict)", async () => {
    const mine = await seedAccount(userId, "me@gmail.com", {
      grantedScopes: CALENDAR_SCOPES,
    });
    mockedFetch.mockImplementation(async (_accountId, path) => {
      if (path.startsWith("https://www.googleapis.com/calendar/v3/")) {
        return new Response("boom", { status: 500 });
      }
      const body = path.includes("/labels")
        ? { labels: [] }
        : path.includes("/profile")
          ? { historyId: "h1" }
          : { threads: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const res = await syncMyEmailAccounts();
    expect(res.ok).toBe(true); // mail synced fine
    expect(res.results[0]).toMatchObject({ accountId: mine, ok: true });
    expect(res.calendar[0]).toMatchObject({ ok: false });
  });

  it("surfaces per-account failures without throwing (ok:false in results)", async () => {
    await seedAccount(userId, "me@gmail.com");
    mockedFetch.mockRejectedValue(new Error("Gmail is down"));

    const res = await syncMyEmailAccounts();
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ ok: false, error: "Gmail is down" });
  });
});

describe("backfillMyEmailAccount", () => {
  /** One local thread so the backfill has an anchor; the fake Gmail
   *  list then serves one OLDER thread to import. */
  async function seedAnchoredMailbox(ownerId: string): Promise<string> {
    const accountId = await seedAccount(ownerId, "me@gmail.com");
    await prisma.emailThread.create({
      data: {
        accountId,
        externalId: "t-anchor",
        subject: "Oldest local",
        lastMessageAt: new Date(1_767_000_000_000),
      },
    });
    return accountId;
  }

  function installOlderThread(): void {
    const older = {
      id: "t-older",
      messages: [
        {
          id: "m-older",
          threadId: "t-older",
          labelIds: ["INBOX"],
          snippet: "older mail",
          internalDate: String(1_767_000_000_000 - 86_400_000),
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Jane <jane@x.co>" },
              { name: "To", value: "me@gmail.com" },
              { name: "Subject", value: "Older thread" },
            ],
            body: {
              data: Buffer.from("hi", "utf8").toString("base64url"),
            },
          },
        },
      ],
    };
    mockedFetch.mockImplementation(async (_accountId, path) => {
      const body = path.includes("/labels")
        ? { labels: [] }
        : path.includes("/threads/t-older")
          ? older
          : path.includes("/threads?")
            ? { threads: [{ id: "t-anchor" }, { id: "t-older" }] }
            : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  it("imports the next older window for the caller's own account and revalidates", async () => {
    const accountId = await seedAnchoredMailbox(userId);
    installOlderThread();

    const res = await backfillMyEmailAccount(accountId);
    expect(res).toEqual({ ok: true, threadsSynced: 1 });

    expect(
      await prisma.emailThread.count({
        where: { accountId, externalId: "t-older" },
      })
    ).toBe(1);
    expect(mockedRevalidate).toHaveBeenCalledWith("/communication");
    expect(mockedRevalidate).toHaveBeenCalledWith("/settings/integrations");
  });

  it("refuses another user's accountId without touching Google", async () => {
    const theirAccount = await seedAnchoredMailbox(otherUserId);

    const res = await backfillMyEmailAccount(theirAccount);
    expect(res).toEqual({
      ok: false,
      threadsSynced: 0,
      error: "Email account not found.",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("catches transient engine failures into {ok:false, error}", async () => {
    const accountId = await seedAnchoredMailbox(userId);
    mockedFetch.mockRejectedValue(new Error("Gmail is down"));

    const res = await backfillMyEmailAccount(accountId);
    expect(res).toMatchObject({ ok: false, error: "Gmail is down" });
  });
});
