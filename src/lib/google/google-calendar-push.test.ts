/**
 * Integration tests for the Google Calendar push module.
 *
 * `gmailFetch` is mocked (the seam with gmail-client); the DB is
 * real because the account resolution + CalendarEventSync mapping
 * side-effects ARE the contract:
 *
 *   - creator resolution: unscoped / token-less accounts skip
 *     silently, multiple scoped accounts → the OLDEST connected
 *     one, an account already holding the event's mapping wins
 *     over an older unmapped one;
 *   - insert (POST) vs patch (PATCH events/{id}) decided by the
 *     mapping row; the mapping is upserted from the response;
 *   - pushed resources always carry the LAWCRM_MARKER_KEY echo
 *     marker and never attendees;
 *   - deleteEventFromGoogle sweeps EVERY mapping, tolerates
 *     404/410, removes mappings, and never rejects;
 *   - never-rejects wrapper semantics: auth errors mark the
 *     account, transients console.warn.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...mod, gmailFetch: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import {
  CALENDAR_API_BASE,
  CALENDAR_EVENTS_SCOPE,
  LAWCRM_MARKER_KEY,
} from "@/lib/google/calendar-shared";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";
import {
  deleteEventFromGoogle,
  pushEventToGoogle,
} from "./google-calendar-push";

const mockedFetch = vi.mocked(gmailFetch);

let userId: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

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

// ── Local fixtures ──────────────────────────────────────────────────────
// NOTE: a shared Google-account seed is landing in
// src/test/integration-helpers.ts alongside the pull engine;
// consolidate this local builder onto it once both halves merge.

/** A Google connection for `userId`. Scoped + tokened by default;
 *  pass overrides to build the skip cases. `createdAt` controls
 *  the oldest-account resolution. */
async function seedGoogleAccount(opts?: {
  ownerId?: string;
  email?: string;
  refreshToken?: string | null;
  grantedScopes?: string | null;
  createdAt?: Date;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts?.ownerId ?? userId,
      emailAddress:
        opts?.email ?? `me-${Math.random().toString(36).slice(2, 8)}@gmail.com`,
      refreshToken:
        opts?.refreshToken === undefined ? "rt-secret" : opts.refreshToken,
      grantedScopes:
        opts?.grantedScopes === undefined
          ? `openid ${CALENDAR_EVENTS_SCOPE}`
          : opts.grantedScopes,
      syncStatus: "connected",
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    },
    select: { id: true },
  });
  return account.id;
}

/** A CRM event created by `userId` (override with `createdById`). */
async function seedEvent(opts?: {
  createdById?: string | null;
  title?: string;
}): Promise<string> {
  const ev = await prisma.calendarEvent.create({
    data: {
      createdById:
        opts?.createdById === undefined ? userId : opts.createdById,
      title: opts?.title ?? "Deposition prep",
      type: "meeting",
      startTime: new Date("2026-08-01T14:00:00Z"),
      endTime: new Date("2026-08-01T15:00:00Z"),
      location: "Conference Room B",
    },
    select: { id: true },
  });
  return ev.id;
}

async function seedMapping(opts: {
  eventId: string;
  accountId: string;
  googleEventId?: string;
  googleCalendarId?: string;
}): Promise<string> {
  const row = await prisma.calendarEventSync.create({
    data: {
      eventId: opts.eventId,
      accountId: opts.accountId,
      googleEventId: opts.googleEventId ?? "g-existing",
      googleCalendarId: opts.googleCalendarId ?? "primary",
    },
    select: { id: true },
  });
  return row.id;
}

const googleOk = (body?: { id?: string; updated?: string }) =>
  new Response(
    JSON.stringify({
      id: body?.id ?? "g-1",
      updated: body?.updated ?? "2026-08-01T16:00:00.000Z",
    }),
    { status: 200 }
  );

describe("pushEventToGoogle — creator/account resolution", () => {
  test("no mapping → POST insert to the creator's primary calendar", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(googleOk());

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [calledAccountId, url, init] = mockedFetch.mock.calls[0];
    expect(calledAccountId).toBe(accountId);
    expect(url).toBe(`${CALENDAR_API_BASE}/calendars/primary/events`);
    expect(init?.method).toBe("POST");
  });

  test("creator without the calendar scope is skipped silently", async () => {
    await seedGoogleAccount({
      grantedScopes: "openid https://www.googleapis.com/auth/gmail.modify",
    });
    const eventId = await seedEvent();

    await pushEventToGoogle(eventId);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(await prisma.calendarEventSync.count()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("token-less (disconnected) account is skipped silently", async () => {
    const accountId = await seedGoogleAccount({ refreshToken: null });
    const eventId = await seedEvent();

    await pushEventToGoogle(eventId);

    expect(mockedFetch).not.toHaveBeenCalled();
    // Crucially the account was NOT flipped to reconnect-required.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
    expect(account.syncError).toBeNull();
  });

  test("creator-less event (legacy row) is skipped silently", async () => {
    await seedGoogleAccount();
    const eventId = await seedEvent({ createdById: null });

    await pushEventToGoogle(eventId);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  test("multiple scoped accounts → pushes ONLY to the oldest connected one", async () => {
    const older = await seedGoogleAccount({
      email: "older@gmail.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await seedGoogleAccount({
      email: "newer@gmail.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(googleOk());

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toBe(older);
    expect(await prisma.calendarEventSync.count()).toBe(1);
  });

  test("oldest account is skipped when unscoped — the scoped one wins", async () => {
    await seedGoogleAccount({
      email: "older-unscoped@gmail.com",
      grantedScopes: "openid",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const scoped = await seedGoogleAccount({
      email: "newer-scoped@gmail.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(googleOk());

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toBe(scoped);
  });

  test("another user's account is never a push target", async () => {
    const { firmId } = await seedFirm({ name: "Other Firm" });
    const other = await seedUser({ firmId });
    await seedGoogleAccount({ ownerId: other.userId });
    const eventId = await seedEvent(); // created by `userId`

    await pushEventToGoogle(eventId);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("pushEventToGoogle — insert vs patch + mapping upsert", () => {
  test("insert upserts the mapping row with the response id + updated stamp", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(
      googleOk({ id: "g-new", updated: "2026-08-02T09:30:00.000Z" })
    );

    await pushEventToGoogle(eventId);

    const mapping = await prisma.calendarEventSync.findUniqueOrThrow({
      where: { eventId_accountId: { eventId, accountId } },
    });
    expect(mapping.googleEventId).toBe("g-new");
    expect(mapping.googleCalendarId).toBe("primary");
    expect(mapping.googleUpdatedAt?.toISOString()).toBe(
      "2026-08-02T09:30:00.000Z"
    );
  });

  test("existing mapping → PATCH events/{googleEventId}, not POST", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId, googleEventId: "g-77" });
    mockedFetch.mockResolvedValue(
      googleOk({ id: "g-77", updated: "2026-08-03T12:00:00.000Z" })
    );

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [, url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(
      `${CALENDAR_API_BASE}/calendars/primary/events/g-77`
    );
    expect(init?.method).toBe("PATCH");
    // Mapping stamp refreshed, still exactly one row.
    const mappings = await prisma.calendarEventSync.findMany({
      where: { eventId },
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0].googleUpdatedAt?.toISOString()).toBe(
      "2026-08-03T12:00:00.000Z"
    );
  });

  test("pulled (Google-born) event: PATCH carries the echo marker, making the copy 'ours'", async () => {
    // The pull engine imports a Google event (no marker on the
    // Google side) and records the mapping. A CRM edit then pushes
    // back: mapping exists → PATCH, and the patch body includes
    // the LAWCRM_MARKER_KEY extended property — the previously
    // unmarked Google copy is marker-tagged from now on. Correct
    // and intended: an event the CRM has edited is "ours".
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent({ title: "Pulled from Google" });
    await seedMapping({ eventId, accountId, googleEventId: "g-born" });
    mockedFetch.mockResolvedValue(googleOk({ id: "g-born" }));

    await pushEventToGoogle(eventId);

    const [, url, init] = mockedFetch.mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(url).toContain("/events/g-born");
    const body = JSON.parse(String(init?.body));
    expect(body.extendedProperties.private[LAWCRM_MARKER_KEY]).toBe(eventId);
  });

  test("mapping on a NEWER account beats an older unmapped account (no duplicate copy)", async () => {
    await seedGoogleAccount({
      email: "older@gmail.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const mapped = await seedGoogleAccount({
      email: "newer-mapped@gmail.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId: mapped, googleEventId: "g-5" });
    mockedFetch.mockResolvedValue(googleOk({ id: "g-5" }));

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [calledAccountId, , init] = mockedFetch.mock.calls[0];
    expect(calledAccountId).toBe(mapped);
    expect(init?.method).toBe("PATCH");
  });

  test("PATCH 404 (deleted at Google) → warn, no re-insert, mapping left for the pull engine", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId, googleEventId: "g-gone" });
    mockedFetch.mockResolvedValue(new Response("", { status: 404 }));

    await pushEventToGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(1); // no follow-up POST
    expect(warnSpy).toHaveBeenCalled();
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(1);
  });

  test("pushed resource carries the echo marker and never attendees", async () => {
    await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(googleOk());

    await pushEventToGoogle(eventId);

    const body = JSON.parse(String(mockedFetch.mock.calls[0][2]?.body));
    expect(body.extendedProperties.private[LAWCRM_MARKER_KEY]).toBe(eventId);
    expect(body.summary).toBe("Deposition prep");
    expect(body).not.toHaveProperty("attendees");
  });
});

describe("pushEventToGoogle — never-rejects contract", () => {
  test("GmailAuthError → reconnect signal recorded on the account, no throw", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockRejectedValue(
      new GmailAuthError("Reconnect this mailbox.", accountId)
    );

    await expect(pushEventToGoogle(eventId)).resolves.toBeUndefined();

    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.syncError).toBe("Reconnect this mailbox.");
  });

  test("transient 500 → console.warn, no throw, no mapping row", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    await expect(pushEventToGoogle(eventId)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(await prisma.calendarEventSync.count()).toBe(0);
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
  });

  test("network-level rejection is swallowed with a warn", async () => {
    await seedGoogleAccount();
    const eventId = await seedEvent();
    mockedFetch.mockRejectedValue(new Error("socket hang up"));

    await expect(pushEventToGoogle(eventId)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("missing event (deleted mid-flight) is a silent no-op", async () => {
    await expect(pushEventToGoogle("nonexistent")).resolves.toBeUndefined();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("deleteEventFromGoogle", () => {
  test("DELETEs every mapping's Google copy and removes the mappings", async () => {
    const a1 = await seedGoogleAccount({ email: "a1@gmail.com" });
    const a2 = await seedGoogleAccount({ email: "a2@gmail.com" });
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId: a1, googleEventId: "g-a1" });
    await seedMapping({ eventId, accountId: a2, googleEventId: "g-a2" });
    mockedFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteEventFromGoogle(eventId);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const urls = mockedFetch.mock.calls.map((c) => c[1]).sort();
    expect(urls).toEqual([
      `${CALENDAR_API_BASE}/calendars/primary/events/g-a1`,
      `${CALENDAR_API_BASE}/calendars/primary/events/g-a2`,
    ]);
    for (const call of mockedFetch.mock.calls) {
      expect(call[2]?.method).toBe("DELETE");
    }
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(0);
  });

  test("404/410 (already gone) tolerated — mappings still removed, no warn", async () => {
    const a1 = await seedGoogleAccount({ email: "a1@gmail.com" });
    const a2 = await seedGoogleAccount({ email: "a2@gmail.com" });
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId: a1, googleEventId: "g-a1" });
    await seedMapping({ eventId, accountId: a2, googleEventId: "g-a2" });
    mockedFetch
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 410 }));

    await expect(deleteEventFromGoogle(eventId)).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(0);
  });

  test("token-less account skips the network but its mapping is still removed", async () => {
    const disconnected = await seedGoogleAccount({
      email: "gone@gmail.com",
      refreshToken: null,
    });
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId: disconnected });

    await deleteEventFromGoogle(eventId);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(0);
  });

  test("auth error on one account marks it and still sweeps the other", async () => {
    const bad = await seedGoogleAccount({
      email: "bad@gmail.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const good = await seedGoogleAccount({
      email: "good@gmail.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId: bad, googleEventId: "g-bad" });
    await seedMapping({ eventId, accountId: good, googleEventId: "g-good" });
    mockedFetch.mockImplementation(async (accountId: string) => {
      if (accountId === bad) {
        throw new GmailAuthError("Reconnect this mailbox.", bad);
      }
      return new Response(null, { status: 204 });
    });

    await expect(deleteEventFromGoogle(eventId)).resolves.toBeUndefined();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const badAccount = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: bad },
    });
    expect(badAccount.syncStatus).toBe("error");
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(0);
  });

  test("transient failure warns (orphaned-copy honesty) and never blocks", async () => {
    const accountId = await seedGoogleAccount();
    const eventId = await seedEvent();
    await seedMapping({ eventId, accountId });
    mockedFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    await expect(deleteEventFromGoogle(eventId)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    // Mapping removed anyway — the CRM delete proceeds; the Google
    // copy is orphaned (documented v1 trade-off).
    expect(await prisma.calendarEventSync.count({ where: { eventId } })).toBe(0);
  });

  test("no mappings is a silent no-op", async () => {
    const eventId = await seedEvent();
    await expect(deleteEventFromGoogle(eventId)).resolves.toBeUndefined();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
