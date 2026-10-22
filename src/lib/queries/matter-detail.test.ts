/**
 * Integration tests for the matter Time tab queries.
 *
 * Pins the list-cap / aggregate split introduced when the Time tab
 * stopped fetching unbounded rows:
 *
 *   1. getMatterTimeEntries is capped (newest-first) at
 *      MATTER_TIME_ENTRIES_LIMIT = 200 — a long-running hourly
 *      matter must not ship its entire history (plus attached note
 *      bodies) to render one tab.
 *
 *   2. getMatterTimeSummary aggregates in the database, so totals
 *      cover EVERY entry — including ones past the list cap — and
 *      per-bucket money sums happen in Decimal (no float dust from
 *      row-by-row JS accumulation).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// matter-detail.ts imports getCurrentUserId (for the Notes tab's
// read-tracking); stub it so the auth chain (@clerk/nextjs → next/server)
// doesn't have to load. The time queries under test never call it.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// The deadline / task / event queries resolve the viewer's zone for
// their calendar-day math; the real resolver is `server-only`.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  expenseDeletedTitle,
  expenseEditedTitle,
  expenseLoggedTitle,
} from "@/lib/expense-activity";
import {
  getMatterActivity,
  getMatterActivityTypeCounts,
  getMatterDeadlines,
  getMatterEvents,
  getMatterNotes,
  getMatterParties,
  getMatterTasks,
  getMatterTimeEntries,
  getMatterTimeSummary,
} from "@/lib/queries/matter-detail";
import { getCurrentUserId } from "@/lib/current-user";
import {
  resetDb,
  seedCalendarEvent,
  seedContact,
  seedFirm,
  seedMatter,
  seedMatterContact,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let userId: string;

/** A time entry with full control over the summary-relevant fields
 *  (the shared seedTimeEntry helper doesn't expose noCharge/date). */
async function seedEntry(opts: {
  hours?: number;
  amount?: number | string | null;
  billable?: boolean;
  noCharge?: boolean;
  status?: string;
  date?: Date;
}): Promise<string> {
  const row = await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      date: opts.date ?? new Date("2026-06-15"),
      hours: opts.hours ?? 1,
      activity: "Test work",
      amount: opts.amount == null ? null : new Prisma.Decimal(opts.amount),
      billable: opts.billable ?? true,
      noCharge: opts.noCharge ?? false,
      status: opts.status ?? "draft",
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

describe("getMatterTimeEntries — list cap", () => {
  test("caps at 200 newest entries while the summary still covers all rows", async () => {
    // 205 one-hour entries on distinct ascending dates so the
    // newest-first ordering is unambiguous.
    const base = Date.UTC(2026, 0, 1);
    await prisma.timeEntry.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        matterId,
        userId,
        date: new Date(base + i * 86_400_000),
        hours: 1,
        activity: `Test work #${i}`,
        billable: true,
        status: "draft",
      })),
    });

    const entries = await getMatterTimeEntries(matterId);
    expect(entries).toHaveLength(200);
    // Newest first — the 5 oldest (#0–#4) fall past the cap.
    expect(entries[0].activity).toBe("Test work #204");
    expect(entries[199].activity).toBe("Test work #5");

    // The aggregate side must NOT be capped with the list.
    const summary = await getMatterTimeSummary(matterId);
    expect(summary.totalHours).toBe(205);
    expect(summary.billableHours).toBe(205);
  });

  test("explicit limit option overrides the default cap", async () => {
    const base = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 4; i++) {
      await seedEntry({ date: new Date(base + i * 86_400_000) });
    }
    const entries = await getMatterTimeEntries(matterId, { limit: 3 });
    expect(entries).toHaveLength(3);
  });
});

describe("getMatterTimeSummary — bucketing", () => {
  test("splits billed vs unbilled and excludes no-charge / non-billable from billable totals", async () => {
    await seedEntry({ hours: 2, amount: 500, status: "billed" });
    await seedEntry({ hours: 1.5, amount: 375, status: "draft" });
    await seedEntry({ hours: 1, amount: 250, status: "billable" });
    // No-charge: counts toward total hours only.
    await seedEntry({ hours: 3, amount: 750, noCharge: true });
    // Non-billable, no amount: counts toward total hours only.
    await seedEntry({ hours: 0.5, amount: null, billable: false });

    const summary = await getMatterTimeSummary(matterId);
    expect(summary.totalHours).toBe(8);
    expect(summary.billableHours).toBe(4.5);
    expect(summary.billedAmount).toBe(500);
    expect(summary.unbilledAmount).toBe(625);
  });

  test("amount sums are exact at cent precision (Decimal math in the DB)", async () => {
    // 0.1 + 0.2 in doubles is 0.30000000000000004 — the classic
    // reproducer. Both entries land in the same groupBy bucket, so
    // Postgres sums them in Decimal and hands back exactly 0.3.
    await seedEntry({ amount: "0.10", status: "draft" });
    await seedEntry({ amount: "0.20", status: "draft" });

    const summary = await getMatterTimeSummary(matterId);
    expect(summary.unbilledAmount).toBe(0.3);
  });
});

describe("matter activity — settlement / expense amounts are permission-gated", () => {
  beforeEach(async () => {
    const rows = [
      { type: "settlement", title: "Settlement opened · gross $250000.00" },
      { type: "settlement", title: "Lien added · Aetna · $12000.00" },
      { type: "filing", title: "Expense logged · $450.00 · Court reporter" },
      { type: "filing", title: "Expense deleted · $450.00 · Court reporter" },
      // Unrelated filing + other types must always survive.
      { type: "filing", title: "Complaint filed" },
      { type: "note", title: "Note added" },
      // Trust ledger movement: billing.view.
      { type: "deposit", title: "Trust deposit · $5000.00" },
    ];
    await prisma.activityLog.createMany({
      data: rows.map((r) => ({ matterId, userId, ...r })),
    });
  });

  const titles = async (
    access: {
      canViewSettlement?: boolean;
      canViewExpense?: boolean;
      canViewBilling?: boolean;
    },
    types?: string[],
  ) => (await getMatterActivity(matterId, { ...access, types })).map((r) => r.title).sort();

  test("viewer without either key sees neither settlement nor expense rows", async () => {
    expect(await titles({})).toEqual(["Complaint filed", "Note added"]);
    // The Financial / Filings pill queries are filtered too.
    expect(await titles({}, ["deposit", "settlement"])).toEqual([]);
    expect(await titles({}, ["filing"])).toEqual(["Complaint filed"]);
    expect(await getMatterActivityTypeCounts(matterId)).toEqual({
      filing: 1,
      note: 1,
    });
  });

  test("settlement.view alone reveals settlement rows but not expenses", async () => {
    const t = await titles({ canViewSettlement: true });
    expect(t).toContain("Settlement opened · gross $250000.00");
    expect(t).toContain("Lien added · Aetna · $12000.00");
    expect(t.some((x) => x.startsWith("Expense "))).toBe(false);
    expect(await getMatterActivityTypeCounts(matterId, { canViewSettlement: true })).toEqual({
      settlement: 2,
      filing: 1,
      note: 1,
    });
  });

  test("expense.view alone reveals expense rows but not settlements", async () => {
    const t = await titles({ canViewExpense: true });
    expect(t).toContain("Expense logged · $450.00 · Court reporter");
    expect(t).toContain("Expense deleted · $450.00 · Court reporter");
    expect(t.some((x) => x.includes("Settlement") || x.includes("Lien"))).toBe(false);
    expect(await getMatterActivityTypeCounts(matterId, { canViewExpense: true })).toEqual({
      filing: 3,
      note: 1,
    });
  });

  test("billing.view alone reveals trust deposit rows and nothing else money-bearing", async () => {
    expect(await titles({ canViewBilling: true })).toEqual([
      "Complaint filed",
      "Note added",
      "Trust deposit · $5000.00",
    ]);
    expect(await titles({}, ["deposit"])).toEqual([]);
    expect(await titles({ canViewBilling: true }, ["deposit"])).toEqual([
      "Trust deposit · $5000.00",
    ]);
    expect(await getMatterActivityTypeCounts(matterId, { canViewBilling: true })).toEqual({
      deposit: 1,
      filing: 1,
      note: 1,
    });
  });

  test("holding all three keys shows everything", async () => {
    expect(
      await titles({
        canViewSettlement: true,
        canViewExpense: true,
        canViewBilling: true,
      }),
    ).toHaveLength(7);
  });

  test("hiding follows the titles the expense actions actually write", async () => {
    // expenses.ts builds its ActivityLog titles through these same
    // helpers, so a format change can't silently reopen the leak.
    await prisma.activityLog.deleteMany({ where: { matterId } });
    await prisma.activityLog.createMany({
      data: [
        expenseLoggedTitle(12.5, "Filing fee"),
        expenseEditedTitle("Filing fee"),
        expenseDeletedTitle(new Prisma.Decimal("12.5"), "Filing fee"),
      ].map((title) => ({ matterId, userId, type: "filing", title })),
    });
    expect(await titles({})).toEqual([]);
    expect(await titles({ canViewExpense: true })).toHaveLength(3);
  });
});

describe("getMatterNotes - render-time re-sanitization", () => {
  test("a legacy note stored with class/script is cleaned on read", async () => {
    // Simulates a row written before the sanitizer dropped `class`:
    // the Tailwind-overlay payload must not reach the client.
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    await prisma.note.create({
      data: {
        matterId,
        authorId: userId,
        type: "note",
        content: '<p class="fixed inset-0 z-50 bg-white">pwn</p><script>alert(1)</script>',
      },
    });
    const notes = await getMatterNotes(matterId);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("<p>pwn</p>");
  });
});

describe("getMatterTimeSummary — written-off entries", () => {
  test("written_off is in neither bucket; WIP statuses stay unbilled; billed stays billed", async () => {
    await seedEntry({ hours: 2, amount: 600, status: "written_off" });
    await seedEntry({ hours: 1, amount: 300, status: "draft" });
    await seedEntry({ hours: 1, amount: 300, status: "submitted" });
    await seedEntry({ hours: 1, amount: 300, status: "billable" });
    await seedEntry({ hours: 1, amount: 300, status: "billed" });

    const summary = await getMatterTimeSummary(matterId);
    // Hours still count (the work happened)…
    expect(summary.totalHours).toBe(6);
    expect(summary.billableHours).toBe(6);
    // …but a write-off is no longer "WIP to invoice".
    expect(summary.unbilledAmount).toBe(900);
    expect(summary.billedAmount).toBe(300);
  });
});

describe("deadlines / tasks — calendar-day math in the viewer's zone", () => {
  // 2026-04-28T02:00Z is 8 PM on Apr 27 in Denver (MDT): the viewer's
  // "today" is Apr 27 even though the UTC clock already says Apr 28.
  const EVENING_DENVER = new Date("2026-04-28T02:00:00.000Z");

  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_DENVER);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const dl = (title: string, due: string, status = "open") =>
    prisma.deadline.create({
      data: {
        matterId,
        title,
        status,
        dueDate: new Date(`${due}T00:00:00.000Z`),
      },
    });

  test("a deadline due today is 0 days away and NOT overdue (no '0d late')", async () => {
    await dl("Due today", "2026-04-27");
    const [d] = await getMatterDeadlines(matterId);
    expect(d.daysUntil).toBe(0);
    expect(d.isOverdue).toBe(false);
  });

  test("yesterday is 1 day late; tomorrow is 1 day away", async () => {
    await dl("Yesterday", "2026-04-26");
    await dl("Tomorrow", "2026-04-28");
    const byTitle = Object.fromEntries(
      (await getMatterDeadlines(matterId)).map((d) => [d.title, d]),
    );
    expect(byTitle["Yesterday"].daysUntil).toBe(-1);
    expect(byTitle["Yesterday"].isOverdue).toBe(true);
    expect(byTitle["Tomorrow"].daysUntil).toBe(1);
    expect(byTitle["Tomorrow"].isOverdue).toBe(false);
  });

  test("a completed past deadline is never flagged overdue", async () => {
    await dl("Done", "2026-04-01", "completed");
    const [d] = await getMatterDeadlines(matterId);
    expect(d.isOverdue).toBe(false);
  });

  test("an explicit tz overrides the session zone", async () => {
    await dl("Due Apr 28", "2026-04-28");
    // In UTC it is already Apr 28, so the deadline is due today.
    const [d] = await getMatterDeadlines(matterId, { tz: "UTC" });
    expect(d.daysUntil).toBe(0);
  });

  test("open deadlines sort before completed / waived ones, each by due date", async () => {
    await dl("Old completed", "2026-01-10", "completed");
    await dl("Late open", "2026-09-01");
    await dl("Soon open", "2026-05-01");
    await dl("Old waived", "2026-02-10", "waived");
    const rows = await getMatterDeadlines(matterId);
    expect(rows.map((r) => r.title)).toEqual([
      "Soon open",
      "Late open",
      "Old completed",
      "Old waived",
    ]);
  });

  test("openOnly + limit returns just the next open rows (Overview preview)", async () => {
    await dl("Done", "2026-01-10", "completed");
    for (const [i, due] of ["2026-05-01", "2026-05-02", "2026-05-03"].entries()) {
      await dl(`Open ${i}`, due);
    }
    const rows = await getMatterDeadlines(matterId, { openOnly: true, limit: 2 });
    expect(rows.map((r) => r.title)).toEqual(["Open 0", "Open 1"]);
  });

  test("tasks use the same day math", async () => {
    await prisma.task.createMany({
      data: [
        { matterId, title: "Today", dueDate: new Date("2026-04-27T00:00:00Z") },
        { matterId, title: "Tomorrow", dueDate: new Date("2026-04-28T00:00:00Z") },
        { matterId, title: "Overdue", dueDate: new Date("2026-04-25T00:00:00Z") },
        { matterId, title: "Undated" },
      ],
    });
    const byTitle = Object.fromEntries(
      (await getMatterTasks(matterId)).map((t) => [t.title, t.daysUntilDue]),
    );
    expect(byTitle).toEqual({
      Today: 0,
      Tomorrow: 1,
      Overdue: -2,
      Undated: null,
    });
  });

  test("tasks openOnly drops done / cancelled rows", async () => {
    await prisma.task.createMany({
      data: [
        { matterId, title: "A", status: "open" },
        { matterId, title: "B", status: "in_progress" },
        { matterId, title: "C", status: "done" },
      ],
    });
    const rows = await getMatterTasks(matterId, { openOnly: true });
    expect(rows.map((r) => r.title).sort()).toEqual(["A", "B"]);
  });
});

describe("getMatterEvents — upcoming split", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    vi.useFakeTimers({ toFake: ["Date"] });
    // 8 PM Apr 27 in Denver.
    vi.setSystemTime(new Date("2026-04-28T02:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("an all-day event on the viewer's today is upcoming, yesterday's is past", async () => {
    await seedCalendarEvent({
      createdById: userId,
      matterId,
      title: "All day today",
      isAllDay: true,
      startTime: new Date("2026-04-27T00:00:00Z"),
      endTime: new Date("2026-04-27T00:00:00Z"),
    });
    await seedCalendarEvent({
      createdById: userId,
      matterId,
      title: "All day yesterday",
      isAllDay: true,
      startTime: new Date("2026-04-26T00:00:00Z"),
      endTime: new Date("2026-04-26T00:00:00Z"),
    });
    await seedCalendarEvent({
      createdById: userId,
      matterId,
      title: "Ended an hour ago",
      startTime: new Date("2026-04-28T00:00:00Z"),
      endTime: new Date("2026-04-28T01:00:00Z"),
    });
    await seedCalendarEvent({
      createdById: userId,
      matterId,
      title: "Later tonight",
      startTime: new Date("2026-04-28T03:00:00Z"),
      endTime: new Date("2026-04-28T04:00:00Z"),
    });
    const flags = Object.fromEntries(
      (await getMatterEvents(matterId)).map((e) => [e.title, e.isUpcoming]),
    );
    expect(flags).toEqual({
      "All day today": true,
      "All day yesterday": false,
      "Ended an hour ago": false,
      "Later tonight": true,
    });
  });
});

describe("getMatterParties — representation falls back only without a linked contact", () => {
  test("a linked rep contact's cleared organization is not resurrected from the legacy mirror", async () => {
    const { contactId: partyId } = await seedContact({
      name: "Opposing Party",
      type: "opposing_party",
    });
    const { contactId: repId } = await seedContact({
      name: "Sonia Steele",
      type: "opposing_counsel",
      organization: null,
    });
    const { matterContactId } = await seedMatterContact({
      matterId,
      contactId: partyId,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: matterContactId },
      data: {
        isRepresented: true,
        representationContactId: repId,
        representationName: "Old Name",
        representationFirm: "Steele & Marsh",
        representationEmail: "old@example.com",
        representationPhone: "555-0100",
      },
    });
    const [row] = await getMatterParties(matterId);
    expect(row.representationName).toBe("Sonia Steele");
    expect(row.representationFirm).toBeNull();
    expect(row.representationEmail).toBeNull();
    expect(row.representationPhone).toBeNull();
  });

  test("without a linked contact the legacy text columns still show", async () => {
    const { contactId: partyId } = await seedContact({
      name: "Opposing Party",
      type: "opposing_party",
    });
    const { matterContactId } = await seedMatterContact({
      matterId,
      contactId: partyId,
      category: "opposing",
    });
    await prisma.matterContact.update({
      where: { id: matterContactId },
      data: { isRepresented: true, representationFirm: "Steele & Marsh" },
    });
    const [row] = await getMatterParties(matterId);
    expect(row.representationFirm).toBe("Steele & Marsh");
  });
});

describe("getMatterNotes — labels and pinned filter", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  });

  test("a reply's parent label decodes entities (no '&amp;')", async () => {
    const parent = await prisma.note.create({
      data: {
        matterId,
        authorId: userId,
        content: "<p>Call w/ Smith &amp; Jones</p>",
      },
    });
    await prisma.note.create({
      data: {
        matterId,
        authorId: userId,
        content: "<p>reply</p>",
        parentNoteId: parent.id,
      },
    });
    const reply = (await getMatterNotes(matterId)).find((n) => n.parentNoteId === parent.id);
    expect(reply?.link).toMatchObject({
      kind: "parent",
      label: "Call w/ Smith & Jones",
    });
  });

  test("pinnedOnly returns just the pinned notes", async () => {
    await prisma.note.create({
      data: { matterId, authorId: userId, content: "<p>pinned</p>", isPinned: true },
    });
    await prisma.note.create({
      data: { matterId, authorId: userId, content: "<p>plain</p>" },
    });
    const rows = await getMatterNotes(matterId, { pinnedOnly: true });
    expect(rows.map((r) => r.content)).toEqual(["<p>pinned</p>"]);
    expect(await getMatterNotes(matterId)).toHaveLength(2);
  });
});

describe("getMatterTimeEntries — event source chip", () => {
  test("time logged on an event shows a 'From event' chip, Busy-scrubbed for non-team viewers", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: userId,
      matterId,
      title: "Privileged strategy call",
    });
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date("2026-06-15T00:00:00Z"),
        hours: 1,
        activity: "Call",
        calendarEventId: eventId,
      },
    });

    // The matter lead (team member + creator) sees the real title.
    vi.mocked(getCurrentUserId).mockResolvedValue(userId);
    const [seen] = await getMatterTimeEntries(matterId);
    expect(seen.spawnedFrom).toEqual({
      kind: "event",
      id: eventId,
      label: "Privileged strategy call",
    });

    // A firm member who is neither creator, attendee nor on the team
    // gets "Busy".
    const { id: firmId } = await prisma.firm.findFirstOrThrow({ select: { id: true } });
    const { userId: outsiderId } = await seedUser({ firmId });
    vi.mocked(getCurrentUserId).mockResolvedValue(outsiderId);
    const [scrubbed] = await getMatterTimeEntries(matterId);
    expect(scrubbed.spawnedFrom?.label).toBe("Busy");
  });
});
