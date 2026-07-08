/**
 * Integration tests for the Google Calendar PULL engine.
 *
 * `gmailFetch` (the authenticated-fetch seam calendar calls ride)
 * is mocked with a tiny fake Google Calendar; the DATABASE IS REAL
 * (test Postgres) because the persistence rules ARE the feature:
 *
 *   - scope gating (unscoped accounts skip with zero traffic);
 *   - incremental syncToken flow + nextSyncToken persistence,
 *     410 GONE → full windowed re-pull, pagination;
 *   - unmarked import shape (creator / visibility / type /
 *     matterless) + mapping row;
 *   - marked-event mapping upsert + last-write-wins (older Google
 *     `updated` never overwrites the CRM row);
 *   - the cancellation rule matrix (sole-mapping personal → event
 *     deleted; filed / other-attendee / multi-mapping → mapping-
 *     only delete, CRM event survives);
 *   - auth-error account marking vs transient note-and-rethrow,
 *     calendar-prefixed syncError hygiene;
 *   - echo safety: the pull module must never import the push
 *     module or the calendar-events actions (whose hooks push).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/gmail-client", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/google/gmail-client")>();
  return { ...mod, gmailFetch: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import {
  CALENDAR_EVENTS_SCOPE,
  LAWCRM_MARKER_KEY,
  type GoogleEventResource,
} from "@/lib/google/calendar-shared";
import {
  resetDb,
  seedCalendarEvent,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import {
  CALENDAR_SYNC_ERROR_PREFIX,
  CalendarSyncError,
  PULL_WINDOW_FUTURE_DAYS,
  PULL_WINDOW_PAST_DAYS,
  pullCalendarForAccount,
  pullCalendarForUserAccounts,
} from "./google-calendar-sync";

const mockedFetch = vi.mocked(gmailFetch);

const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPES_WITH_CALENDAR = `openid email https://www.googleapis.com/auth/gmail.modify ${CALENDAR_EVENTS_SCOPE}`;
const SCOPES_WITHOUT_CALENDAR =
  "openid email https://www.googleapis.com/auth/gmail.modify";

let firmId: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  mockedFetch.mockReset();
  ({ firmId } = await seedFirm());
  ({ userId } = await seedUser({ firmId }));
});

async function seedAccount(opts?: {
  ownerId?: string;
  email?: string;
  grantedScopes?: string | null;
  calendarSyncToken?: string | null;
  syncStatus?: string;
  syncError?: string | null;
}): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: opts?.ownerId ?? userId,
      emailAddress: opts?.email ?? "me@gmail.com",
      refreshToken: "rt-secret",
      syncStatus: opts?.syncStatus ?? "connected",
      syncError: opts?.syncError ?? null,
      grantedScopes:
        opts?.grantedScopes === undefined
          ? SCOPES_WITH_CALENDAR
          : opts.grantedScopes,
      calendarSyncToken: opts?.calendarSyncToken ?? null,
    },
    select: { id: true },
  });
  return account.id;
}

// ── Fake-Google builders ─────────────────────────────────────────────────

function gEvent(opts: {
  id: string;
  summary?: string;
  status?: string;
  updated?: string;
  marker?: string;
  description?: string;
  location?: string;
  start?: GoogleEventResource["start"];
  end?: GoogleEventResource["end"];
}): GoogleEventResource {
  return {
    id: opts.id,
    status: opts.status ?? "confirmed",
    summary: opts.summary ?? "Google event",
    description: opts.description,
    location: opts.location,
    start: opts.start ?? { dateTime: "2026-08-01T15:00:00.000Z" },
    end: opts.end ?? { dateTime: "2026-08-01T16:00:00.000Z" },
    updated: opts.updated ?? "2026-07-01T00:00:00.000Z",
    ...(opts.marker
      ? { extendedProperties: { private: { [LAWCRM_MARKER_KEY]: opts.marker } } }
      : {}),
  };
}

const listResponse = (
  body: {
    items?: GoogleEventResource[];
    nextPageToken?: string;
    nextSyncToken?: string;
  },
  status = 200
) => new Response(JSON.stringify(body), { status });

/** The URL of the nth events.list call, parsed. */
function callUrl(n = 0): URL {
  return new URL(String(mockedFetch.mock.calls[n][1]));
}

// ── Scope gating ─────────────────────────────────────────────────────────

describe("scope gating", () => {
  it("skips accounts without the calendar scope — zero Google traffic", async () => {
    const accountId = await seedAccount({
      grantedScopes: SCOPES_WITHOUT_CALENDAR,
    });
    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: true, mode: "skipped", imported: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("skips accounts with NULL grantedScopes (pre-column connections)", async () => {
    const accountId = await seedAccount({ grantedScopes: null });
    const res = await pullCalendarForAccount(accountId);
    expect(res.mode).toBe("skipped");
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

// ── Full pull + import shape ─────────────────────────────────────────────

describe("full windowed pull", () => {
  it("imports an unmarked Google event as a personal CRM meeting + mapping, persists the sync token", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValueOnce(
      listResponse({
        items: [
          gEvent({
            id: "g-1",
            summary: "Dentist",
            description: "bring insurance card",
            location: "12 Main St",
            updated: "2026-07-06T10:00:00.000Z",
          }),
        ],
        nextSyncToken: "st-1",
      })
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: true, mode: "full", imported: 1 });

    // Windowed list on primary with singleEvents, no syncToken.
    const url = callUrl();
    expect(url.pathname).toContain("/calendar/v3/calendars/primary/events");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("syncToken")).toBeNull();
    const timeMin = new Date(url.searchParams.get("timeMin")!);
    const timeMax = new Date(url.searchParams.get("timeMax")!);
    expect(Date.now() - timeMin.getTime()).toBeCloseTo(
      PULL_WINDOW_PAST_DAYS * DAY_MS,
      -5
    );
    expect(timeMax.getTime() - Date.now()).toBeCloseTo(
      PULL_WINDOW_FUTURE_DAYS * DAY_MS,
      -5
    );

    // Import shape: personal event owned by the connection's user.
    const event = await prisma.calendarEvent.findFirstOrThrow({
      include: { googleSyncs: true },
    });
    expect(event).toMatchObject({
      createdById: userId,
      visibility: "default",
      type: "meeting",
      matterId: null,
      title: "Dentist",
      description: "bring insurance card",
      location: "12 Main St",
      isAllDay: false,
    });
    expect(event.startTime.toISOString()).toBe("2026-08-01T15:00:00.000Z");
    expect(event.googleSyncs).toHaveLength(1);
    expect(event.googleSyncs[0]).toMatchObject({
      accountId,
      googleEventId: "g-1",
    });
    expect(event.googleSyncs[0].googleUpdatedAt?.toISOString()).toBe(
      "2026-07-06T10:00:00.000Z"
    );

    // Cursor persisted for the next incremental pass.
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.calendarSyncToken).toBe("st-1");
  });

  it("walks pagination to exhaustion before taking the final page's nextSyncToken", async () => {
    const accountId = await seedAccount();
    mockedFetch
      .mockResolvedValueOnce(
        listResponse({
          items: [gEvent({ id: "g-1" })],
          nextPageToken: "page-2",
        })
      )
      .mockResolvedValueOnce(
        listResponse({
          items: [gEvent({ id: "g-2", summary: "Second" })],
          nextSyncToken: "st-final",
        })
      );

    const res = await pullCalendarForAccount(accountId);
    expect(res.imported).toBe(2);
    expect(callUrl(1).searchParams.get("pageToken")).toBe("page-2");
    expect(
      (
        await prisma.emailAccount.findUniqueOrThrow({
          where: { id: accountId },
        })
      ).calendarSyncToken
    ).toBe("st-final");
  });
});

// ── Incremental + 410 ────────────────────────────────────────────────────

describe("incremental pull", () => {
  it("sends the stored syncToken (and no window params), persisting the rotated token", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    mockedFetch.mockResolvedValueOnce(
      listResponse({ items: [], nextSyncToken: "st-1" })
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res.mode).toBe("incremental");
    const url = callUrl();
    expect(url.searchParams.get("syncToken")).toBe("st-0");
    expect(url.searchParams.get("timeMin")).toBeNull();
    expect(url.searchParams.get("timeMax")).toBeNull();
    expect(
      (
        await prisma.emailAccount.findUniqueOrThrow({
          where: { id: accountId },
        })
      ).calendarSyncToken
    ).toBe("st-1");
  });

  it("falls back to a full windowed re-pull on 410 GONE (expired sync token)", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-stale" });
    mockedFetch
      .mockResolvedValueOnce(new Response("Gone", { status: 410 }))
      .mockResolvedValueOnce(
        listResponse({
          items: [gEvent({ id: "g-1" })],
          nextSyncToken: "st-fresh",
        })
      );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: true, mode: "full", imported: 1 });
    // Second call is the windowed full pull — no stale token.
    const url = callUrl(1);
    expect(url.searchParams.get("syncToken")).toBeNull();
    expect(url.searchParams.get("timeMin")).not.toBeNull();
    expect(
      (
        await prisma.emailAccount.findUniqueOrThrow({
          where: { id: accountId },
        })
      ).calendarSyncToken
    ).toBe("st-fresh");
  });
});

// ── Marked events + last-write-wins ──────────────────────────────────────

describe("marked events (lawcrm marker) + LWW", () => {
  it("upserts the mapping and applies a NEWER Google edit to the CRM row", async () => {
    const accountId = await seedAccount();
    const { eventId } = await seedCalendarEvent({
      createdById: userId,
      title: "CRM title",
    });

    mockedFetch.mockResolvedValueOnce(
      listResponse({
        items: [
          gEvent({
            id: "g-pushed",
            summary: "Edited in Google",
            marker: eventId,
            // Strictly newer than the row's just-written updatedAt.
            updated: new Date(Date.now() + 60_000).toISOString(),
          }),
        ],
        nextSyncToken: "st",
      })
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ imported: 0, updated: 1 });

    const event = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(event.title).toBe("Edited in Google");
    const mapping = await prisma.calendarEventSync.findUniqueOrThrow({
      where: { accountId_googleEventId: { accountId, googleEventId: "g-pushed" } },
    });
    expect(mapping.eventId).toBe(eventId);
  });

  it("never overwrites the CRM row with an OLDER Google `updated` (CRM wins)", async () => {
    const accountId = await seedAccount();
    const { eventId } = await seedCalendarEvent({
      createdById: userId,
      title: "CRM title",
    });
    // Pre-existing mapping — the steady-state pushed-copy case.
    await prisma.calendarEventSync.create({
      data: { eventId, accountId, googleEventId: "g-pushed" },
    });

    mockedFetch.mockResolvedValueOnce(
      listResponse({
        items: [
          gEvent({
            id: "g-pushed",
            summary: "Stale Google copy",
            marker: eventId,
            updated: "2020-01-01T00:00:00.000Z",
          }),
        ],
        nextSyncToken: "st",
      })
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ imported: 0, updated: 0 });
    const event = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(event.title).toBe("CRM title"); // untouched
    // Mapping bookkeeping still moved.
    const mapping = await prisma.calendarEventSync.findUniqueOrThrow({
      where: { accountId_googleEventId: { accountId, googleEventId: "g-pushed" } },
    });
    expect(mapping.googleUpdatedAt?.toISOString()).toBe(
      "2020-01-01T00:00:00.000Z"
    );
  });

  it("skips a marker pointing at a CRM event that no longer exists (no resurrection)", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValueOnce(
      listResponse({
        items: [gEvent({ id: "g-orphan", marker: "gone-event-id" })],
        nextSyncToken: "st",
      })
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: true, imported: 0, updated: 0 });
    expect(await prisma.calendarEvent.count()).toBe(0);
    expect(await prisma.calendarEventSync.count()).toBe(0);
  });
});

// ── Cancellation rule matrix ─────────────────────────────────────────────

describe("cancellation rule", () => {
  const cancelled = (googleEventId: string) =>
    listResponse({
      items: [{ id: googleEventId, status: "cancelled" }],
      nextSyncToken: "st",
    });

  async function seedMapped(opts: {
    accountId: string;
    matterId?: string | null;
    attendees?: Parameters<typeof seedCalendarEvent>[0]["attendees"];
  }): Promise<string> {
    const { eventId } = await seedCalendarEvent({
      createdById: userId,
      matterId: opts.matterId ?? null,
      attendees: opts.attendees,
    });
    await prisma.calendarEventSync.create({
      data: { eventId, accountId: opts.accountId, googleEventId: "g-x" },
    });
    return eventId;
  }

  it("deletes a personal Google-born event (sole mapping, no matter, owner-only attendee)", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    const eventId = await seedMapped({
      accountId,
      attendees: [{ userId, name: "Me" }],
    });
    mockedFetch.mockResolvedValueOnce(cancelled("g-x"));

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ deletedEvents: 1, unlinked: 0 });
    expect(
      await prisma.calendarEvent.count({ where: { id: eventId } })
    ).toBe(0);
    expect(await prisma.calendarEventSync.count()).toBe(0);
  });

  it("keeps a FILED event — deletes only the mapping", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const eventId = await seedMapped({ accountId, matterId });
    mockedFetch.mockResolvedValueOnce(cancelled("g-x"));

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ deletedEvents: 0, unlinked: 1 });
    expect(
      await prisma.calendarEvent.count({ where: { id: eventId } })
    ).toBe(1);
    expect(await prisma.calendarEventSync.count()).toBe(0);
  });

  it("keeps an event with attendees beyond the account owner", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    const { userId: colleagueId } = await seedUser({
      firmId,
      email: "colleague@kosloskilaw.com",
    });
    const eventId = await seedMapped({
      accountId,
      attendees: [
        { userId, name: "Me" },
        { userId: colleagueId, name: "Colleague" },
      ],
    });
    mockedFetch.mockResolvedValueOnce(cancelled("g-x"));

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ deletedEvents: 0, unlinked: 1 });
    expect(
      await prisma.calendarEvent.count({ where: { id: eventId } })
    ).toBe(1);
  });

  it("keeps an event synced to MULTIPLE Google calendars — only this mapping drops", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    const otherAccountId = await seedAccount({ email: "second@gmail.com" });
    const eventId = await seedMapped({ accountId });
    await prisma.calendarEventSync.create({
      data: {
        eventId,
        accountId: otherAccountId,
        googleEventId: "g-other-copy",
      },
    });
    mockedFetch.mockResolvedValueOnce(cancelled("g-x"));

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ deletedEvents: 0, unlinked: 1 });
    expect(
      await prisma.calendarEvent.count({ where: { id: eventId } })
    ).toBe(1);
    // The other account's mapping survives.
    expect(await prisma.calendarEventSync.count()).toBe(1);
  });

  it("ignores a cancellation with no local mapping", async () => {
    const accountId = await seedAccount({ calendarSyncToken: "st-0" });
    mockedFetch.mockResolvedValueOnce(cancelled("g-never-seen"));
    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: true, deletedEvents: 0, unlinked: 0 });
  });
});

// ── Failure semantics ────────────────────────────────────────────────────

describe("failure semantics", () => {
  it("GmailAuthError flips the account to error and returns ok:false (no throw)", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockRejectedValueOnce(
      new GmailAuthError("Reconnect this mailbox.", accountId)
    );

    const res = await pullCalendarForAccount(accountId);
    expect(res).toMatchObject({ ok: false, error: "Reconnect this mailbox." });
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("error");
    expect(account.syncError).toBe("Reconnect this mailbox.");
  });

  it("transient failure notes a calendar-prefixed syncError and rethrows; status untouched", async () => {
    const accountId = await seedAccount();
    mockedFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(pullCalendarForAccount(accountId)).rejects.toThrow(
      CalendarSyncError
    );
    const account = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(account.syncStatus).toBe("connected");
    expect(account.syncError).toBe(
      `${CALENDAR_SYNC_ERROR_PREFIX}Google Calendar events list failed (500).`
    );
  });

  it("a later success clears ITS OWN note but never an email-sync failure note", async () => {
    const calendarFailed = await seedAccount({
      syncError: `${CALENDAR_SYNC_ERROR_PREFIX}old calendar failure`,
    });
    const mailFailed = await seedAccount({
      email: "two@gmail.com",
      syncError: "Last sync failed: Gmail thread list failed (500).",
    });
    // Fresh Response per call — a shared body can only be read once.
    mockedFetch.mockImplementation(async () =>
      listResponse({ items: [], nextSyncToken: "st" })
    );

    await pullCalendarForAccount(calendarFailed);
    await pullCalendarForAccount(mailFailed);

    expect(
      (
        await prisma.emailAccount.findUniqueOrThrow({
          where: { id: calendarFailed },
        })
      ).syncError
    ).toBeNull();
    expect(
      (
        await prisma.emailAccount.findUniqueOrThrow({
          where: { id: mailFailed },
        })
      ).syncError
    ).toBe("Last sync failed: Gmail thread list failed (500).");
  });
});

// ── Multi-account wrapper ────────────────────────────────────────────────

describe("pullCalendarForUserAccounts", () => {
  it("scopes to the user, isolates per-account transient failures, skips reconnect-required rows", async () => {
    const good = await seedAccount();
    const broken = await seedAccount({ email: "broken@gmail.com" });
    const needsReconnect = await seedAccount({
      email: "revoked@gmail.com",
      syncStatus: "error",
      syncError: "Reconnect required.",
    });
    const { userId: otherId } = await seedUser({
      firmId,
      email: "other@kosloskilaw.com",
    });
    await seedAccount({ ownerId: otherId, email: "other@gmail.com" });

    mockedFetch.mockImplementation(async (accountId) => {
      if (accountId === broken) return new Response("boom", { status: 500 });
      return listResponse({
        items: [gEvent({ id: `g-${accountId}` })],
        nextSyncToken: "st",
      });
    });

    const results = await pullCalendarForUserAccounts(userId);
    expect(results).toHaveLength(3); // never the other user's account
    const byId = new Map(results.map((r) => [r.accountId, r]));
    expect(byId.get(good)).toMatchObject({ ok: true, imported: 1 });
    expect(byId.get(broken)).toMatchObject({ ok: false, mode: "skipped" });
    expect(byId.get(needsReconnect)).toMatchObject({
      ok: false,
      mode: "skipped",
      error: "Reconnect required.",
    });
    // The reconnect-required account produced no Google traffic.
    expect(
      mockedFetch.mock.calls.some(([id]) => id === needsReconnect)
    ).toBe(false);
  });
});

// ── Echo safety ──────────────────────────────────────────────────────────

describe("echo safety", () => {
  it("the pull module never imports the push module or the calendar-events actions", () => {
    // Pull writes go through prisma directly; the server actions
    // carry the push hooks, so importing either would let a pull
    // echo Google's own change back at Google.
    // import.meta.url isn't a file: URL under happy-dom — resolve
    // from the project root (vitest's cwd) instead.
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/google/google-calendar-sync.ts"),
      "utf8"
    );
    // Comments may NAME the push module (they document the split);
    // what must never exist is an import/require of it.
    const importish = [
      ...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(importish.length).toBeGreaterThan(0);
    for (const specifier of importish) {
      expect(specifier).not.toContain("google-calendar-push");
      expect(specifier).not.toContain("actions/calendar-events");
    }
  });
});
