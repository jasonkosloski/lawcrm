/**
 * Matter-team access (ethical walls, ADR-039) across the cross-matter
 * READ surfaces: dashboard, contact detail, calendar, /time, reports,
 * the conflict-check display and the file-download routes.
 *
 * Real Postgres, firm in TEAM mode. Two users:
 *   alice - on matter A only
 *   bob   - on matter B only
 * Every case asserts that bob does NOT see A's data and alice does.
 */

import { Readable } from "node:stream";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({
  statFile: vi.fn(async () => null), // allowed requests end in 410
  openReadStream: vi.fn(() => Readable.from([])),
  signedBlobUrl: vi.fn(),
  isBlobKey: () => false,
}));
vi.mock("@/lib/email-attachments", async (orig) => ({
  ...(await orig<typeof import("@/lib/email-attachments")>()),
  ensureAttachmentBytes: vi.fn(async () => {
    throw new Error("storage down"); // allowed requests end in 502
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { dateOnlyKey, parseDateOnly, todayKey } from "@/lib/format-date";
import {
  getDashboardKpis,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
} from "@/lib/queries/dashboard";
import { getContactById, listContacts } from "@/lib/queries/contacts";
import {
  getCalendarEventById,
  getCalendarItems,
} from "@/lib/queries/calendar";
import { getEditableEventIds } from "@/lib/queries/calendar-edit-flags";
import { getMyDayTime, getMyWeekTime } from "@/lib/queries/time";
import {
  getCurrentTimerSession,
  getTimerMatterOptions,
} from "@/lib/queries/timer";
import { getArAgingReport, getPipelineReport } from "@/lib/queries/reports";
import { redactConflictResultForViewer } from "@/lib/conflict-check-redact";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import { GET as downloadDocument } from "@/app/api/documents/[id]/download/route";
import { GET as downloadAttachment } from "@/app/api/email-attachments/[id]/download/route";
import {
  resetDb,
  seedCalendarEvent,
  seedContact,
  seedDocument,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);
const TZ = "UTC";
const today = todayKey(TZ);
const todayDate = parseDateOnly(today)!;

let firmId: string;
let defaultRoleId: string;
let alice: string;
let bob: string;
let matterA: string;
let matterB: string;

beforeEach(async () => {
  await resetDb();
  ({ firmId, defaultRoleId } = await seedFirm());
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: "TEAM" },
  });
  ({ userId: alice } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  ({ userId: bob } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId: matterA } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: alice,
    name: "Secret Matter A",
  }));
  ({ matterId: matterB } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: bob,
    name: "Matter B",
  }));
  mockedUser.mockResolvedValue(bob);
});

const as = (userId: string) => mockedUser.mockResolvedValue(userId);

describe("dashboard", () => {
  test("open-matter KPI counts only accessible matters", async () => {
    expect((await getDashboardKpis(TZ)).openMatters).toBe(1);
    as(alice);
    expect((await getDashboardKpis(TZ)).openMatters).toBe(1);
  });

  test("my tasks: matter tasks on a hidden matter drop, firm-wide tasks stay", async () => {
    await prisma.task.createMany({
      data: [
        { title: "hidden", matterId: matterA, ownerId: bob },
        { title: "firm-wide", matterId: null, ownerId: bob },
        { title: "mine", matterId: matterB, ownerId: bob },
      ],
    });
    const t = await getMyOpenTasks(TZ);
    expect(t.total).toBe(2);
    expect(t.noDueDate.map((x) => x.title).sort()).toEqual([
      "firm-wide",
      "mine",
    ]);
  });

  test("deadlines card shows only accessible matters", async () => {
    await prisma.deadline.create({
      data: { matterId: matterA, title: "A due", dueDate: todayDate },
    });
    expect((await getUpcomingDeadlines(TZ)).items).toHaveLength(0);
    as(alice);
    expect((await getUpcomingDeadlines(TZ)).items.map((d) => d.title)).toEqual([
      "A due",
    ]);
  });

  test("recent activity hides rows on a hidden matter", async () => {
    await prisma.activityLog.create({
      data: { matterId: matterA, type: "note", title: "A secret note" },
    });
    await prisma.activityLog.create({
      data: { matterId: matterB, type: "note", title: "B note" },
    });
    expect((await getRecentActivity(TZ)).map((a) => a.title)).toEqual([
      "B note",
    ]);
  });

  test("agenda: an event on a hidden matter is a Busy block, even for an invitee", async () => {
    await seedCalendarEvent({
      createdById: alice,
      matterId: matterA,
      title: "Strategy call",
      isAllDay: true,
      startTime: todayDate,
      endTime: todayDate,
      attendees: [{ userId: bob, name: "Bob" }],
    });
    const bobs = await getTodayAgenda(TZ);
    expect(bobs).toHaveLength(1);
    expect(bobs[0]!.title).toBe("Busy");
    as(alice);
    expect((await getTodayAgenda(TZ))[0]!.title).toBe("Strategy call");
  });

  test("follow-ups on a thread filed to a hidden matter are left off", async () => {
    const account = await prisma.emailAccount.create({
      data: {
        userId: bob,
        emailAddress: "bob@example.com",
        refreshToken: "x",
      },
    });
    await prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "filed to A",
        matterId: matterA,
        followUpAt: new Date(Date.UTC(2020, 0, 1)),
        lastMessageAt: new Date(),
      },
    });
    await prisma.emailThread.create({
      data: {
        accountId: account.id,
        subject: "unfiled",
        followUpAt: new Date(Date.UTC(2020, 0, 1)),
        lastMessageAt: new Date(),
      },
    });
    expect((await getFollowUpsDueToday(TZ)).map((f) => f.label)).toEqual([
      "unfiled",
    ]);
  });
});

describe("contacts", () => {
  test("list counts and detail matter lists leave out hidden matters", async () => {
    const { contactId } = await seedContact({ name: "Pat Client" });
    await prisma.matter.update({
      where: { id: matterA },
      data: { clientId: contactId },
    });
    await seedMatterContact({
      matterId: matterB,
      contactId,
      category: "opposing",
    });

    // bob: only B
    const bobList = await listContacts({});
    expect(bobList.find((c) => c.id === contactId)!.matterCount).toBe(1);
    const bobDetail = (await getContactById(contactId))!;
    expect(bobDetail.asClientMatters).toHaveLength(0);
    expect(bobDetail.asPartyMatters.map((p) => p.matterName)).toEqual([
      "Matter B",
    ]);
    expect(bobDetail.matterCount).toBe(1);

    // alice: only A
    as(alice);
    const aliceDetail = (await getContactById(contactId))!;
    expect(aliceDetail.asClientMatters.map((m) => m.name)).toEqual([
      "Secret Matter A",
    ]);
    expect(aliceDetail.asPartyMatters).toHaveLength(0);
  });

  test("conflict-check hits keep their severity but lose the hidden matter's name", async () => {
    const result = {
      severity: "conflict" as const,
      matches: [
        {
          kind: "matter_opposing_party" as const,
          severity: "conflict" as const,
          matchedField: "name" as const,
          description: 'Appears as opposing on matter "Secret Matter A"',
          matterId: matterA,
        },
        {
          kind: "matter_opposing_party" as const,
          severity: "conflict" as const,
          matchedField: "name" as const,
          description: 'Appears as opposing on matter "Matter B"',
          matterId: matterB,
        },
      ],
    };
    const redacted = await redactConflictResultForViewer(bob, result);
    expect(redacted.severity).toBe("conflict");
    expect(redacted.matches).toHaveLength(2);
    expect(JSON.stringify(redacted)).not.toContain("Secret Matter A");
    expect(redacted.matches[0]!.matterId).toBeUndefined();
    expect(redacted.matches[1]!.description).toContain("Matter B");
  });
});

describe("calendar", () => {
  const start = new Date("2026-08-03T15:00:00.000Z");
  const range = [
    new Date("2026-08-03T00:00:00.000Z"),
    new Date("2026-08-04T00:00:00.000Z"),
  ] as const;

  test("an event on a hidden matter is Busy (details scrubbed), deadlines drop", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: alice,
      matterId: matterA,
      title: "Hearing prep",
      startTime: start,
      attendees: [{ userId: bob, name: "Bob" }],
    });
    await prisma.deadline.create({
      data: {
        matterId: matterA,
        title: "A deadline",
        dueDate: parseDateOnly("2026-08-03")!,
      },
    });

    const items = await getCalendarItems(range[0], range[1], TZ);
    const ev = items.find((i) => i.id === eventId)!;
    expect(ev.kind === "event" && ev.viewerCanSeeDetails).toBe(false);
    expect(ev.kind === "event" && ev.title).toBe("Busy");
    expect(ev.kind === "event" && ev.matterId).toBeNull();
    expect(items.some((i) => i.kind === "deadline")).toBe(false);

    const detail = (await getCalendarEventById(eventId))!;
    expect(detail.viewerCanSeeDetails).toBe(false);
    expect(detail.title).toBe("Busy");
    expect(detail.matter).toBeNull();

    as(alice);
    const aliceItems = await getCalendarItems(range[0], range[1], TZ);
    const aliceEv = aliceItems.find((i) => i.id === eventId)!;
    expect(aliceEv.kind === "event" && aliceEv.title).toBe("Hearing prep");
    expect(aliceItems.some((i) => i.kind === "deadline")).toBe(true);
  });

  test("the creator still sees their OWN event on a matter they can't access", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: bob,
      matterId: matterA,
      title: "Bob's own entry",
      startTime: start,
    });
    const items = await getCalendarItems(range[0], range[1], TZ);
    const ev = items.find((i) => i.id === eventId)!;
    expect(ev.kind === "event" && ev.title).toBe("Bob's own entry");
  });

  test("a Busy private event is not editable; the wall also blocks edit affordances", async () => {
    const priv = await seedCalendarEvent({
      createdById: alice,
      title: "Alice private",
      visibility: "private",
      startTime: start,
    });
    const walled = await seedCalendarEvent({
      createdById: alice,
      matterId: matterA,
      title: "walled",
      startTime: start,
    });
    const ids = await getEditableEventIds([priv.eventId, walled.eventId]);
    expect(ids.size).toBe(0);
  });

  test("canViewEventDetails: the wall beats attendee status and show_details", () => {
    const base = {
      viewerId: "v",
      createdById: "c",
      eventVisibility: "show_details",
      creatorDefaultEventVisibility: "show_details",
      matterId: "m",
      attendeeUserIds: ["v"],
      matterTeamUserIds: ["v"],
    };
    expect(canViewEventDetails({ ...base, matterAccessible: true })).toBe(true);
    expect(canViewEventDetails({ ...base, matterAccessible: false })).toBe(
      false
    );
    // creator exemption (documented choice)
    expect(
      canViewEventDetails({ ...base, createdById: "v", matterAccessible: false })
    ).toBe(true);
    // no matter -> flag irrelevant
    expect(
      canViewEventDetails({ ...base, matterId: null, matterAccessible: false })
    ).toBe(true);
  });
});

describe("time", () => {
  test("own entries on a hidden matter disappear from day and week views", async () => {
    await prisma.timeEntry.createMany({
      data: [matterA, matterB].map((matterId) => ({
        matterId,
        userId: bob,
        date: todayDate,
        hours: 1,
        activity: "work",
        rate: new Prisma.Decimal(100),
        amount: new Prisma.Decimal(100),
      })),
    });
    const day = await getMyDayTime(today);
    expect(day.logged.map((e) => e.matterName)).toEqual(["Matter B"]);
    expect(day.totalHours).toBe(1);
    const week = await getMyWeekTime([today]);
    expect(week.days[0]!.segments.map((s) => s.matterName)).toEqual([
      "Matter B",
    ]);
  });

  test("a running timer on a hidden matter identifies nothing; pickers list accessible matters only", async () => {
    await prisma.timerSession.create({
      data: { userId: bob, matterId: matterA, activity: "x" },
    });
    const t = await getCurrentTimerSession();
    expect(t).not.toBeNull();
    expect(t!.matterId).toBeNull();
    expect(t!.matterName).toBeNull();
    expect((await getTimerMatterOptions()).map((m) => m.name)).toEqual([
      "Matter B",
    ]);
  });
});

describe("reports", () => {
  async function invoice(matterId: string, n: string) {
    await prisma.invoice.create({
      data: {
        invoiceNumber: n,
        matterId,
        kind: "client",
        issueDate: new Date(Date.UTC(2020, 0, 1)),
        dueDate: new Date(Date.UTC(2020, 1, 1)),
        totalAmount: new Prisma.Decimal(100),
        paidAmount: new Prisma.Decimal(0),
        status: "sent",
      },
    });
  }

  test("A/R totals stay firm-wide aggregates; the named worst-offender rows are filtered", async () => {
    await invoice(matterA, "INV-A");
    await invoice(matterB, "INV-B");
    const r = await getArAgingReport(TZ);
    expect(r.totalOutstanding).toBe(200);
    expect(r.invoiceCount).toBe(2);
    expect(r.worstOffenders.map((o) => o.invoiceNumber)).toEqual(["INV-B"]);
  });

  test("pipeline open-matter counts only the viewer's accessible matters", async () => {
    expect((await getPipelineReport(TZ)).totalOpenMatters).toBe(1);
    as(alice);
    expect((await getPipelineReport(TZ)).totalOpenMatters).toBe(1);
  });
});

describe("download routes answer 404 (not 403) for a hidden matter", () => {
  test("document download", async () => {
    const { documentId } = await seedDocument({ matterId: matterA });
    await prisma.document.update({
      where: { id: documentId },
      data: { fileUrl: "k__x.pdf", contentType: "application/pdf" },
    });
    const call = (uid: string) => {
      vi.mocked(getSession).mockResolvedValue({ user: { id: uid } } as never);
      return downloadDocument(
        new Request(`http://localhost/api/documents/${documentId}/download`) as never,
        { params: Promise.resolve({ id: documentId }) }
      );
    };
    expect((await call(bob)).status).toBe(404);
    // alice passes the wall (the mocked storage then reports it missing)
    expect((await call(alice)).status).toBe(410);
  });

  test("email attachment on a thread filed to a hidden matter", async () => {
    const account = await prisma.emailAccount.create({
      data: { userId: bob, emailAddress: "b@example.com", refreshToken: "x" },
    });
    const mk = async (matterId: string | null) => {
      const thread = await prisma.emailThread.create({
        data: {
          accountId: account.id,
          subject: "s",
          matterId,
          lastMessageAt: new Date(),
        },
      });
      const msg = await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          externalId: `m-${Math.random()}`,
          fromName: "x",
          fromEmail: "x@example.com",
          toRecipients: "[]",
          body: "b",
          sentAt: new Date(),
        },
      });
      const att = await prisma.emailAttachment.create({
        data: {
          messageId: msg.id,
          filename: "a.pdf",
          contentType: "application/pdf",
          fileSize: 1,
          fileUrl: "gmail:1",
        },
      });
      return att.id;
    };
    const hidden = await mk(matterA);
    const filedToB = await mk(matterB);
    const unfiled = await mk(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: bob } } as never);
    const call = (id: string) =>
      downloadAttachment(
        new Request(`http://localhost/api/email-attachments/${id}/download`) as never,
        { params: Promise.resolve({ id }) }
      );
    expect((await call(hidden)).status).toBe(404);
    // accessible / unfiled get past the wall (mocked storage fails -> 502)
    expect((await call(filedToB)).status).toBe(502);
    expect((await call(unfiled)).status).toBe(502);
  });
});

test("sanity: dateOnlyKey round trip used above", () => {
  expect(dateOnlyKey(todayDate)).toBe(today);
});
