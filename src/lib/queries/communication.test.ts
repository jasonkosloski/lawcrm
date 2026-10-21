/**
 * Integration tests for the email-thread read queries.
 *
* Pinned here: the mailbox-scoping security boundary
 * (getThreadById / listThreads / counts never reach another user's
 * mail), the Inbox archive/snooze matrix, and that every rail count
 * equals its list's length (the badge and the list must agree).
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  defaultEmailFilter,
  getCommunicationCounts,
  getCommunicationPinnedMatters,
  getEmailUnreadCount,
  getFilingLeadOptions,
  getFilingMatterOptions,
  getThreadById,
  listThreads,
  listThreadsForLead,
  listThreadsForMatter,
  THREAD_PAGE_SIZE,
  type CommunicationFilter,
} from "@/lib/queries/communication";
import {
  resetDb,
  seedFirm,
  seedLead,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
const mockedGetUser = vi.mocked(getCurrentUserId);

let userId: string;
let accountId: string;

async function seedAccount(ownerId: string): Promise<string> {
  const account = await prisma.emailAccount.create({
    data: {
      userId: ownerId,
      emailAddress: `inbox-${Math.random().toString(36).slice(2, 8)}@firm.test`,
    },
    select: { id: true },
  });
  return account.id;
}


beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  mockedGetUser.mockResolvedValue(userId);
  accountId = await seedAccount(userId);
});

// -- Mailbox scoping, filters, counts -----------------------------------

let otherUserId: string;
let otherAccountId: string;
let matterId: string;

async function seedFlagged(opts: {
  accountId: string;
  subject: string;
  at?: string;
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  followUpAt?: Date | null;
  matterId?: string | null;
  leadId?: string | null;
}): Promise<string> {
  const at = new Date(opts.at ?? "2026-06-01T10:00:00Z");
  const t = await prisma.emailThread.create({
    data: {
      accountId: opts.accountId,
      subject: opts.subject,
      lastMessageAt: at,
      isRead: opts.isRead ?? true,
      isStarred: opts.isStarred ?? false,
      isArchived: opts.isArchived ?? false,
      followUpAt: opts.followUpAt ?? null,
      matterId: opts.matterId ?? null,
      leadId: opts.leadId ?? null,
      messages: {
        create: [
          {
            fromName: "Sender",
            fromEmail: "sender@example.com",
            toRecipients: "[]",
            body: "b",
            sentAt: at,
          },
        ],
      },
    },
    select: { id: true },
  });
  return t.id;
}

describe("mailbox scoping (security boundary)", () => {
  beforeEach(async () => {
    const { firmId } = await seedFirm();
    ({ userId: otherUserId } = await seedUser({ firmId }));
    otherAccountId = await seedAccount(otherUserId);
  });

  test("getThreadById returns null for another user's thread id", async () => {
    const theirs = await seedFlagged({
      accountId: otherAccountId,
      subject: "Privileged: theirs",
    });
    const mine = await seedFlagged({ accountId, subject: "Mine" });

    expect(await getThreadById(theirs)).toBeNull();
    expect((await getThreadById(mine))?.subject).toBe("Mine");
  });

  test("every list and count ignores other users' mailboxes", async () => {
    await seedFlagged({ accountId, subject: "Mine", isRead: false });
    await seedFlagged({
      accountId: otherAccountId,
      subject: "Theirs",
      isRead: false,
      isStarred: true,
    });

    for (const f of ["inbox", "all", "unread", "starred", "unfiled"] as const) {
      const { rows } = await listThreads(f);
      expect(rows.every((r) => r.subject === "Mine")).toBe(true);
    }
    const counts = await getCommunicationCounts();
    expect(counts.all).toBe(1);
    expect(counts.unread).toBe(1);
    expect(counts.starred).toBe(0);
    expect(await getEmailUnreadCount()).toBe(1);
  });

  test("listThreadsForMatter is scoped to the viewer's own mailbox", async () => {
    const area = await seedPracticeArea();
    const m = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    });
    await seedFlagged({ accountId, subject: "Mine", matterId: m.matterId });
    await seedFlagged({
      accountId: otherAccountId,
      subject: "Theirs",
      matterId: m.matterId,
    });
    const { rows } = await listThreadsForMatter(m.matterId);
    expect(rows.map((r) => r.subject)).toEqual(["Mine"]);
  });
});

describe("listThreads filters + counts agree", () => {
  const NOW = Date.now();
  const FUTURE = new Date(NOW + 7 * 86_400_000);
  const PAST = new Date(NOW - 7 * 86_400_000);

  beforeEach(async () => {
    const area = await seedPracticeArea();
    ({ matterId } = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    }));
    await seedFlagged({ accountId, subject: "plain" });
    await seedFlagged({ accountId, subject: "unread", isRead: false });
    await seedFlagged({ accountId, subject: "starred", isStarred: true });
    await seedFlagged({ accountId, subject: "archived", isArchived: true });
    await seedFlagged({
      accountId,
      subject: "archived-unread",
      isArchived: true,
      isRead: false,
    });
    await seedFlagged({ accountId, subject: "snoozed", followUpAt: FUTURE });
    await seedFlagged({ accountId, subject: "snooze-expired", followUpAt: PAST });
    await seedFlagged({ accountId, subject: "filed", matterId });
    await seedFlagged({
      accountId,
      subject: "filed-archived",
      matterId,
      isArchived: true,
    });
  });

  const FILTERS: CommunicationFilter[] = [
    "inbox",
    "all",
    "unread",
    "starred",
    "archived",
    "unfiled",
    "filed",
    "untimed",
  ];

  test.each(FILTERS)("rail count for '%s' equals the list length", async (f) => {
    const counts = await getCommunicationCounts();
    const { rows } = await listThreads(f);
    expect(counts[f]).toBe(rows.length);
  });

  test("Inbox hides archived and still-snoozed threads, shows expired snoozes", async () => {
    const subjects = (await listThreads("inbox")).rows.map((r) => r.subject);
    expect(subjects).toContain("plain");
    expect(subjects).toContain("snooze-expired");
    expect(subjects).not.toContain("snoozed");
    expect(subjects).not.toContain("archived");
    expect(subjects).not.toContain("filed-archived");
    // "All" shows everything.
    expect((await listThreads("all")).rows).toHaveLength(9);
  });

  test("Unread excludes archived threads (same rule as the sidebar badge)", async () => {
    const subjects = (await listThreads("unread")).rows.map((r) => r.subject);
    expect(subjects).toEqual(["unread"]);
    expect(await getEmailUnreadCount()).toBe(1);
    expect((await getCommunicationCounts()).unread).toBe(1);
  });

  test("a matter id overrides the flat filters and reaches archived threads", async () => {
    const subjects = (await listThreads("all", matterId)).rows.map((r) => r.subject);
    expect(subjects.sort()).toEqual(["filed", "filed-archived"]);
  });

  test("untimed drops threads where the viewer logged time on a message", async () => {
    const t = await prisma.emailThread.findFirstOrThrow({
      where: { subject: "plain" },
      include: { messages: true },
    });
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date("2026-06-01"),
        hours: 0.2,
        activity: "email",
        emailMessageId: t.messages[0].id,
      },
    });
    const subjects = (await listThreads("untimed")).rows.map((r) => r.subject);
    expect(subjects).not.toContain("plain");
    expect((await getCommunicationCounts()).untimed).toBe(subjects.length);
  });

  test("a pinned matter's rail badge equals what its drilldown lists", async () => {
    await prisma.userMatterPin.create({ data: { userId, matterId } });
    const pinned = await getCommunicationPinnedMatters();
    expect(pinned).toHaveLength(1);
    // The drilldown's landing filter is the matter-mode default...
    const filter = defaultEmailFilter(matterId);
    expect(filter).toBe("all");
    const { rows } = await listThreads(filter, matterId);
    // ...so the badge (all threads on the matter) matches the list,
    // archived ones included. With the Inbox default it showed 2 vs 1.
    expect(pinned[0].threadCount).toBe(rows.length);
    expect(rows).toHaveLength(2);
    expect(defaultEmailFilter(null)).toBe("inbox");
  });
});

describe("getFilingMatterOptions", () => {
  test("lists open matters only, pinned first", async () => {
    const area = await seedPracticeArea();
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Open A",
    });
    const b = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Open B",
    });
    const archived = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Archived",
    });
    await prisma.matter.update({
      where: { id: archived.matterId },
      data: { isArchived: true },
    });
    await prisma.userMatterPin.create({
      data: { userId, matterId: b.matterId },
    });
    const opts = await getFilingMatterOptions();
    expect(opts.map((o) => o.name)).toEqual(["Open B", "Open A"]);
    expect(opts[0].isPinned).toBe(true);
    expect(opts.some((o) => o.id === archived.matterId)).toBe(false);
  });
});

/** Bulk-seed `n` single-message threads, newest = index 0. */
async function seedManyThreads(
  n: number,
  opts: { accountId: string; matterId?: string; fromEmail?: string }
): Promise<void> {
  const base = Date.parse("2026-01-01T00:00:00Z");
  const threads = await prisma.emailThread.createManyAndReturn({
    data: Array.from({ length: n }, (_, i) => ({
      accountId: opts.accountId,
      subject: `T${i}`,
      messageCount: 1,
      lastMessageAt: new Date(base - i * 60_000),
      matterId: opts.matterId ?? null,
    })),
    select: { id: true, lastMessageAt: true },
  });
  await prisma.emailMessage.createMany({
    data: threads.map((t) => ({
      threadId: t.id,
      fromName: "Sender",
      fromEmail: opts.fromEmail ?? "sender@example.com",
      toRecipients: "[]",
      body: "b",
      sentAt: t.lastMessageAt,
    })),
  });
}

describe("paging (no silent truncation)", () => {
  test("listThreads pages past THREAD_PAGE_SIZE with an exact total", async () => {
    await seedManyThreads(THREAD_PAGE_SIZE + 5, { accountId });

    const first = await listThreads("all");
    expect(first.total).toBe(THREAD_PAGE_SIZE + 5);
    expect(first.pageCount).toBe(2);
    expect(first.rows).toHaveLength(THREAD_PAGE_SIZE);
    expect(first.rows[0].subject).toBe("T0");

    const second = await listThreads("all", undefined, 2);
    expect(second.page).toBe(2);
    expect(second.rows.map((r) => r.subject)).toEqual(
      Array.from({ length: 5 }, (_, i) => `T${THREAD_PAGE_SIZE + i}`)
    );
    // No row appears on both pages.
    const ids = new Set(first.rows.map((r) => r.id));
    expect(second.rows.some((r) => ids.has(r.id))).toBe(false);
  });

  test("out-of-range and junk pages clamp instead of returning nothing", async () => {
    await seedManyThreads(3, { accountId });
    expect((await listThreads("all", undefined, 99)).page).toBe(1);
    expect((await listThreads("all", undefined, 99)).rows).toHaveLength(3);
    expect((await listThreads("all", undefined, Number.NaN)).page).toBe(1);
  });

  test("an empty mailbox is one empty page", async () => {
    const p = await listThreads("inbox");
    expect(p).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
  });

  test("listThreadsForMatter pages too", async () => {
    const area = await seedPracticeArea();
    const m = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    });
    await seedManyThreads(THREAD_PAGE_SIZE + 1, {
      accountId,
      matterId: m.matterId,
    });
    await seedManyThreads(2, { accountId }); // unfiled: not counted
    const p = await listThreadsForMatter(m.matterId, 2);
    expect(p.total).toBe(THREAD_PAGE_SIZE + 1);
    expect(p.rows).toHaveLength(1);
  });

  test("the total honours ethical walls (count and page share one where)", async () => {
    const area = await seedPracticeArea();
    const { firmId } = await seedFirm();
    const { userId: otherId } = await seedUser({ firmId });
    // TEAM mode, no view-all role: the viewer only sees team matters.
    const viewer = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firmId: true },
    });
    await prisma.firm.update({
      where: { id: viewer.firmId! },
      data: { matterVisibility: "TEAM" },
    });
    const walled = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: otherId,
    });
    await seedManyThreads(4, { accountId, matterId: walled.matterId });
    await seedManyThreads(2, { accountId });

    const p = await listThreads("all");
    expect(p.total).toBe(2);
    expect(p.rows.every((r) => r.matter === null)).toBe(true);
  });
});

describe("lead filing in thread queries", () => {
  let bob: string;
  let walled: string;
  let open: string;
  let walledThread: string;
  let openThread: string;
  let matterThread: string;
  let plainThread: string;

  beforeEach(async () => {
    const { firmId } = await seedFirm();
    ({ userId: bob } = await seedUser({ firmId }));
    ({ leadId: walled } = await seedLead({
      name: "Walled Lead",
      restricted: true,
      teamUserIds: [userId],
    }));
    ({ leadId: open } = await seedLead({ name: "Open Lead" }));
    const area = await seedPracticeArea();
    ({ matterId } = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    }));
    // `userId` owns the mailbox; the member is `userId`, bob is the outsider.
    walledThread = await seedFlagged({ accountId, subject: "walled", leadId: walled });
    openThread = await seedFlagged({ accountId, subject: "open", leadId: open });
    matterThread = await seedFlagged({ accountId, subject: "matter", matterId });
    plainThread = await seedFlagged({ accountId, subject: "plain" });
  });

  /** bob owns the same mail but is not on the walled lead's team. */
  async function moveMailboxToBob() {
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { userId: bob },
    });
    mockedGetUser.mockResolvedValue(bob);
  }

  test("thread on a restricted lead is hidden from listThreads, rail counts and getThreadById for a non-member", async () => {
    // Member sees it everywhere.
    expect((await listThreads("all")).rows.map((r) => r.id)).toContain(walledThread);
    expect((await getCommunicationCounts()).all).toBe(4);
    expect(await getThreadById(walledThread)).not.toBeNull();

    await moveMailboxToBob();
    const ids = (await listThreads("all")).rows.map((r) => r.id);
    expect(ids).not.toContain(walledThread);
    expect(ids).toContain(openThread);
    const counts = await getCommunicationCounts();
    expect(counts.all).toBe(3);
    expect(counts.filed).toBe(2);
    expect(counts.unfiled).toBe(1);
    expect(await getThreadById(walledThread)).toBeNull();
    expect(await getThreadById(openThread)).not.toBeNull();
    expect((await listThreadsForLead(walled)).rows).toHaveLength(0);
    await prisma.emailThread.update({
      where: { id: walledThread },
      data: { isRead: false },
    });
    expect(await getEmailUnreadCount()).toBe(0);
  });

  test("an inactive viewer (no lead scope) loses lead-filed threads but keeps unfiled and matter-filed", async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    // Matter access also vanishes for an inactive user, so assert on leads
    // and unfiled only.
    const ids = (await listThreads("all")).rows.map((r) => r.id);
    expect(ids).not.toContain(walledThread);
    expect(ids).not.toContain(openThread);
    expect(ids).toContain(plainThread);
    const c = await getCommunicationCounts();
    expect(c.unfiled).toBe(1);
  });

  test("lead-filed thread is not counted or listed as unfiled", async () => {
    const unfiled = (await listThreads("unfiled")).rows.map((r) => r.id);
    expect(unfiled).toEqual([plainThread]);
    const filed = (await listThreads("filed")).rows.map((r) => r.id).sort();
    expect(filed).toEqual([walledThread, openThread, matterThread].sort());
    const counts = await getCommunicationCounts();
    expect(counts.unfiled).toBe(1);
    expect(counts.filed).toBe(3);
  });

  test("listThreadsForLead returns only the viewer's own threads filed to the lead", async () => {
    const otherAcct = await seedAccount(bob);
    await seedFlagged({ accountId: otherAcct, subject: "bobs", leadId: open });
    const rows = (await listThreadsForLead(open)).rows;
    expect(rows.map((r) => r.id)).toEqual([openThread]);
  });

  test("getThreadById exposes lead and hasAppSentMail", async () => {
    const before = await getThreadById(openThread);
    expect(before?.lead).toEqual({ id: open, name: "Open Lead" });
    expect(before?.matter).toBeNull();
    expect(before?.hasAppSentMail).toBe(false);
    await prisma.emailMessage.updateMany({
      where: { threadId: openThread },
      data: { sentFromApp: true },
    });
    expect((await getThreadById(openThread))?.hasAppSentMail).toBe(true);
    expect((await getThreadById(plainThread))?.lead).toBeNull();
  });

  test("getFilingLeadOptions omits converted and walled leads, keeps declined", async () => {
    const { leadId: converted } = await seedLead({ name: "Converted" });
    await prisma.lead.update({ where: { id: converted }, data: { stage: "converted" } });
    const { leadId: declined } = await seedLead({ name: "Declined" });
    await prisma.lead.update({ where: { id: declined }, data: { stage: "declined" } });

    let ids = (await getFilingLeadOptions()).map((o) => o.id);
    expect(ids).toContain(walled); // member
    expect(ids).not.toContain(converted);
    expect(ids).toContain(declined);

    mockedGetUser.mockResolvedValue(bob);
    ids = (await getFilingLeadOptions()).map((o) => o.id);
    expect(ids).not.toContain(walled);
    expect(ids).toContain(open);
    expect(ids).toContain(declined);
  });
});
