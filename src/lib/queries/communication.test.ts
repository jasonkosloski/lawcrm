/**
 * Integration tests for listThreadsForEmail — the lead Communication
 * tab's address-based thread matcher.
 *
 * The query is a two-pass design: a capped candidate fetch (exact
 * sender match in SQL, loose substring hit on the recipient JSON)
 * plus a message-scoped verification pass. These tests pin the
 * exactness guarantee (a substring collision like "bjoe@x.com" must
 * NOT surface for "joe@x.com"), case-insensitive matching on both
 * sender and recipients, account scoping, and that fromDisplay stays
 * the thread's FIRST sender even when the matching message arrives
 * later in the thread (the candidate fetch only loads one message
 * per thread now).
 *
 * Also pinned here: the mailbox-scoping security boundary
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
  getFilingMatterOptions,
  getThreadById,
  listThreads,
  listThreadsForEmail,
  listThreadsForMatter,
  THREAD_PAGE_SIZE,
  THREADS_FOR_EMAIL_CAP,
  type CommunicationFilter,
} from "@/lib/queries/communication";
import {
  resetDb,
  seedFirm,
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

async function seedThread(opts: {
  accountId: string;
  subject: string;
  messages: Array<{
    fromName?: string;
    fromEmail: string;
    to?: Array<{ name?: string; email: string }>;
    cc?: Array<{ name?: string; email: string }>;
    sentAt: string;
  }>;
}): Promise<string> {
  const last = opts.messages[opts.messages.length - 1];
  const thread = await prisma.emailThread.create({
    data: {
      accountId: opts.accountId,
      subject: opts.subject,
      messageCount: opts.messages.length,
      lastMessageAt: new Date(last.sentAt),
      messages: {
        create: opts.messages.map((m) => ({
          fromName: m.fromName ?? m.fromEmail,
          fromEmail: m.fromEmail,
          toRecipients: JSON.stringify(m.to ?? []),
          ccRecipients: m.cc ? JSON.stringify(m.cc) : null,
          body: "test body",
          sentAt: new Date(m.sentAt),
        })),
      },
    },
    select: { id: true },
  });
  return thread.id;
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

describe("listThreadsForEmail", () => {
  test("matches sender and recipients case-insensitively", async () => {
    await seedThread({
      accountId,
      subject: "From the lead",
      messages: [
        {
          fromEmail: "Lead@Example.com",
          to: [{ email: "me@firm.test" }],
          sentAt: "2026-06-01T10:00",
        },
      ],
    });
    await seedThread({
      accountId,
      subject: "To the lead (cc)",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "other@firm.test" }],
          cc: [{ name: "The Lead", email: "LEAD@example.COM" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });
    // Noise: unrelated correspondence must not surface.
    await seedThread({
      accountId,
      subject: "Unrelated",
      messages: [
        {
          fromEmail: "someone@else.test",
          to: [{ email: "me@firm.test" }],
          sentAt: "2026-06-03T10:00",
        },
      ],
    });

    const { rows } = await listThreadsForEmail("lead@example.com");
    // Newest-first ordering, matching the sibling list queries.
    expect(rows.map((r) => r.subject)).toEqual([
      "To the lead (cc)",
      "From the lead",
    ]);
  });

  test("substring collisions in the recipient JSON do not match", async () => {
    // "joe@x.com" is a substring of "bjoe@x.com" — the SQL contains
    // hit alone would surface this thread; verification must drop it.
    await seedThread({
      accountId,
      subject: "Collision",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "bjoe@x.com" }],
          sentAt: "2026-06-01T10:00",
        },
      ],
    });
    await seedThread({
      accountId,
      subject: "True match",
      messages: [
        {
          fromEmail: "me@firm.test",
          to: [{ email: "joe@x.com" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });

    const { rows } = await listThreadsForEmail("joe@x.com");
    expect(rows.map((r) => r.subject)).toEqual(["True match"]);
  });

  test("scopes to the current user's accounts", async () => {
    const { firmId } = await seedFirm({ name: "Other Firm" });
    const { userId: otherUserId } = await seedUser({ firmId });
    const otherAccountId = await seedAccount(otherUserId);
    await seedThread({
      accountId: otherAccountId,
      subject: "Someone else's thread",
      messages: [
        { fromEmail: "lead@example.com", sentAt: "2026-06-01T10:00" },
      ],
    });

    expect((await listThreadsForEmail("lead@example.com")).rows).toEqual([]);
  });

  test("fromDisplay is the thread's first sender even when a later message matches", async () => {
    await seedThread({
      accountId,
      subject: "Lead replies later",
      messages: [
        {
          fromName: "Pat Paralegal",
          fromEmail: "pat@firm.test",
          to: [{ email: "lead@example.com" }],
          sentAt: "2026-06-01T10:00",
        },
        {
          fromName: "The Lead",
          fromEmail: "lead@example.com",
          to: [{ email: "pat@firm.test" }],
          sentAt: "2026-06-02T10:00",
        },
      ],
    });

    const { rows } = await listThreadsForEmail("lead@example.com");
    expect(rows).toHaveLength(1);
    expect(rows[0].fromDisplay).toBe("Pat Paralegal");
  });

  test("empty email short-circuits to an empty list", async () => {
    expect((await listThreadsForEmail("")).rows).toEqual([]);
  });
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

  test("listThreadsForEmail reports truncation past its cap", async () => {
    await seedManyThreads(THREADS_FOR_EMAIL_CAP + 1, {
      accountId,
      fromEmail: "busy@example.com",
    });
    const hit = await listThreadsForEmail("busy@example.com");
    expect(hit.truncated).toBe(true);
    expect(hit.rows).toHaveLength(THREADS_FOR_EMAIL_CAP);
  }, 30_000);

  test("listThreadsForEmail is not truncated at or under its cap", async () => {
    await seedManyThreads(2, { accountId, fromEmail: "quiet@example.com" });
    const hit = await listThreadsForEmail("quiet@example.com");
    expect(hit).toMatchObject({ truncated: false });
    expect(hit.rows).toHaveLength(2);
  });
});
