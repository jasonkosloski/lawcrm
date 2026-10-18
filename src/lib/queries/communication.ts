/**
 * Communication Queries
 *
 * Server-only data access for the EMAIL half of the unified-inbox
 * /communication page. The SMS / call / voicemail half lives in
 * `@/lib/queries/messenger.ts` (a separate model family).
 *
 * Every email read here is scoped to the viewer's own mailbox via
 * `visibleEmailThreadWhere` (src/lib/email-visibility.ts) - the one
 * definition of which threads a user may see.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import {
  matterAccessWhere,
  optionalMatterAccessClause,
} from "@/lib/matter-access";
import { paginate, type Page } from "@/lib/pagination";

/** Threads per page in the inbox and a matter's Communication tab
 *  (`?page=N`, see src/lib/pagination.ts). */
export const THREAD_PAGE_SIZE = 100;

/** Candidate cap for the lead tab's address match (listThreadsForEmail).
 *  It can't page cheaply (a verification pass runs after the fetch), so
 *  it reports `truncated` and the tab says so instead. */
export const THREADS_FOR_EMAIL_CAP = 500;

/** Ethical walls: a thread filed to a matter the viewer can't see is
 *  hidden from every list / count / reader (unfiled threads stay).
 *  Spread as `AND: await threadMatterAccessAnd(userId)`. */
async function threadMatterAccessAnd(
  userId: string
): Promise<Prisma.EmailThreadWhereInput[]> {
  return (await optionalMatterAccessClause(
    userId
  )) as Prisma.EmailThreadWhereInput[];
}

/** Raw-SQL twin of `threadMatterAccessAnd` for the rail-count scan
 *  (alias `t`). Empty when unrestricted. */
async function threadMatterAccessSql(userId: string): Promise<Prisma.Sql> {
  const where = await matterAccessWhere(userId);
  if (Object.keys(where).length === 0) return Prisma.empty;
  const ids = (
    await prisma.matter.findMany({ where, select: { id: true } })
  ).map((m) => m.id);
  if (ids.length === 0) return Prisma.sql`AND t."matterId" IS NULL`;
  return Prisma.sql`AND (t."matterId" IS NULL OR t."matterId" IN (${Prisma.join(ids)}))`;
}

export type CommunicationFilter =
  /** Default working surface: unarchived threads that aren't
   *  snoozed (followUpAt in the future hides until the date
   *  arrives). This is what most users want most of the time. */
  | "inbox"
  /** Everything, including archived + snoozed. */
  | "all"
  /** Unread threads that are still in the working mailbox -
   *  archived threads don't count (same rule as the sidebar badge
   *  and the rail count, so the three always agree). */
  | "unread"
  | "starred"
  /** Threads archived out of the working inbox (isArchived) — the
   *  counterpart view now that the list rows can archive. */
  | "archived"
  | "unfiled"
  /** Threads associated with any matter (matterId IS NOT NULL). */
  | "filed"
  /** Threads where the current user has not logged time on any
   *  message — surfaces email work the user did but didn't bill. */
  | "untimed";

export type ThreadListRow = {
  id: string;
  subject: string;
  snippet: string | null;
  isRead: boolean;
  isStarred: boolean;
  /** Drives the row's archive/unarchive affordance. */
  isArchived: boolean;
  hasAttachments: boolean;
  messageCount: number;
  lastMessageAt: Date;
  /** Snooze date when set — surfaces as a chip on the row. */
  followUpAt: Date | null;
  /** First sender in the thread — typically "who's emailing me". */
  fromDisplay: string;
  matter: { id: string; name: string; color: string } | null;
};

/** Landing filter when the URL carries none: the working Inbox, except
 *  in a pinned-matter drilldown where the rail badge counts every
 *  thread filed to the matter - archived ones included (filing then
 *  archiving is the normal workflow) - so the list must show them too. */
export function defaultEmailFilter(
  matterId: string | null | undefined
): CommunicationFilter {
  return matterId ? "all" : "inbox";
}

/** Shared include for every thread-list query. */
const threadListInclude = {
  matter: { select: { id: true, name: true, color: true } },
  // First message only - just for fromDisplay.
  messages: {
    orderBy: { sentAt: "asc" },
    take: 1,
    select: { fromName: true, fromEmail: true },
  },
} satisfies Prisma.EmailThreadInclude;

type ThreadListRecord = Prisma.EmailThreadGetPayload<{
  include: typeof threadListInclude;
}>;

function toThreadListRow(t: ThreadListRecord): ThreadListRow {
  return {
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    isArchived: t.isArchived,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    followUpAt: t.followUpAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  };
}

export async function listThreads(
  filter: CommunicationFilter = "all",
  /** When set, filters to threads on this specific matter - used by
   *  the per-pinned-matter sub-rail entries. Overrides matter-related
   *  filters. */
  matterId?: string,
  /** 1-based `?page=`; clamped into range. */
  page = 1
): Promise<Page<ThreadListRow>> {
  const userId = await getCurrentUserId();

  // `where` builds from the filter, but always scoped to the current
  // user's accounts.
  const where: Prisma.EmailThreadWhereInput = {
    ...visibleEmailThreadWhere(userId),
    AND: await threadMatterAccessAnd(userId),
  };
  if (filter === "unread") {
    where.isRead = false;
    where.isArchived = false;
  }
  if (filter === "starred") where.isStarred = true;
  if (filter === "archived") where.isArchived = true;
  if (filter === "unfiled") where.matterId = null;
  if (filter === "filed") where.matterId = { not: null };
  if (filter === "untimed") {
    // No message in this thread has a time entry by the current user.
    // Other users' time entries don't disqualify - this is "what
    // I haven't billed yet" for me specifically.
    where.messages = {
      none: { timeEntries: { some: { userId } } },
    };
  }
  if (filter === "inbox") {
    // Working inbox: not archived AND not snoozed for later.
    Object.assign(where, inboxVisibilityWhere());
  }
  // Per-pinned-matter override - wins over any matter-related filter.
  if (matterId) where.matterId = matterId;

  return pageThreads(where, page);
}

/** One page of threads matching `where`, newest first. The `id`
 *  tiebreak keeps rows sharing a lastMessageAt stable across pages. */
async function pageThreads(
  where: Prisma.EmailThreadWhereInput,
  page: number
): Promise<Page<ThreadListRow>> {
  return paginate(
    page,
    THREAD_PAGE_SIZE,
    () => prisma.emailThread.count({ where }),
    async ({ skip, take }) =>
      (
        await prisma.emailThread.findMany({
          where,
          skip,
          take,
          include: threadListInclude,
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        })
      ).map(toThreadListRow)
  );
}

/** Compact view of a time entry logged against a single email message
 *  or messenger item — surfaces in the per-item time-logged indicator
 *  so the user can see hours + author at a glance without leaving the
 *  reader. */
export type CommTimeEntry = {
  id: string;
  hours: number;
  date: Date;
  activity: string;
  userName: string;
  userInitials: string;
  billable: boolean;
};

export type ThreadMessageView = {
  id: string;
  fromName: string;
  fromEmail: string;
  toRecipients: Array<{ name?: string; email: string }>;
  ccRecipients: Array<{ name?: string; email: string }>;
  body: string;
  sentAt: Date;
  isPrivileged: boolean;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string | null;
    fileSize: number | null;
  }>;
  /** Time entries logged on this specific email — drives the
   *  per-message time-logged chip. Empty array when none. */
  timeEntries: CommTimeEntry[];
};

export type ThreadDetail = {
  id: string;
  subject: string;
  matter: { id: string; name: string; color: string; area: string } | null;
  labels: string[];
  messageCount: number;
  lastMessageAt: Date;
  /** Snooze date — null when no follow-up is set. */
  followUpAt: Date | null;
  messages: ThreadMessageView[];
};

function parseRecipients(raw: string | null): Array<{ name?: string; email: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is { name?: string; email: string } =>
        e && typeof e === "object" && typeof e.email === "string"
    );
  } catch {
    return [];
  }
}

export async function getThreadById(id: string): Promise<ThreadDetail | null> {
  const userId = await getCurrentUserId();
  const thread = await prisma.emailThread.findFirst({
    where: {
      id,
      ...visibleEmailThreadWhere(userId),
      AND: await threadMatterAccessAnd(userId),
    },
    include: {
      matter: {
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
        },
      },
      labels: true,
      messages: {
        include: {
          attachments: true,
          // Per-message time entries — drives the inline "X.Xh logged
          // by JK, RK" indicator in the email reader.
          timeEntries: {
            include: { user: { select: { name: true, initials: true } } },
            orderBy: { date: "asc" },
          },
        },
        orderBy: { sentAt: "asc" },
      },
    },
  });
  if (!thread) return null;
  return {
    id: thread.id,
    subject: thread.subject,
    matter: thread.matter
      ? {
          id: thread.matter.id,
          name: thread.matter.name,
          color: thread.matter.color,
          area: thread.matter.practiceArea.name,
        }
      : null,
    labels: thread.labels.map((l) => l.label),
    messageCount: thread.messageCount,
    lastMessageAt: thread.lastMessageAt,
    followUpAt: thread.followUpAt,
    messages: thread.messages.map((m) => ({
      id: m.id,
      fromName: m.fromName,
      fromEmail: m.fromEmail,
      toRecipients: parseRecipients(m.toRecipients),
      ccRecipients: parseRecipients(m.ccRecipients),
      body: m.body,
      sentAt: m.sentAt,
      isPrivileged: m.isPrivileged,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        fileSize: a.fileSize,
      })),
      timeEntries: m.timeEntries.map((t) => ({
        id: t.id,
        hours: t.hours,
        date: t.date,
        activity: t.activity,
        userName: t.user.name,
        userInitials: t.user.initials,
        billable: t.billable,
      })),
    })),
  };
}

/** Threads whose `matterId` points at this matter — scoped to the
 *  current user's accounts. Used by the matter's Communication tab. */
export async function listThreadsForMatter(
  matterId: string,
  /** 1-based `?page=`; clamped into range. */
  page = 1
): Promise<Page<ThreadListRow>> {
  const userId = await getCurrentUserId();
  return pageThreads(
    {
      matterId,
      ...visibleEmailThreadWhere(userId),
      AND: await threadMatterAccessAnd(userId),
    },
    page
  );
}

/** Threads that touch a given email address (sender OR recipient).
 *  Sender matching runs exactly (case-insensitive) in SQL; recipients
 *  are stored as JSON strings, so those match by substring in SQL and
 *  get sharpened by a message-scoped verification pass below.
 *
 *  Used by the lead Communication tab — since Leads don't have direct
 *  EmailThread links today, email address is the matching key. Schema
 *  may eventually gain a `Lead.threadId[]` relation (see SCHEMA_NOTES
 *  open questions) at which point this becomes a direct join. */
export async function listThreadsForEmail(
  email: string
): Promise<{ rows: ThreadListRow[]; truncated: boolean }> {
  if (!email) return { rows: [], truncated: false };
  const normalized = email.toLowerCase();
  const userId = await getCurrentUserId();

  // Shared by both queries. The recipient `contains` is intentionally
  // loose ("joe@x.com" also hits inside "bjoe@x.com") — the
  // verification pass exact-matches the parsed addresses.
  const matchOr: Prisma.EmailMessageWhereInput[] = [
    { fromEmail: { equals: normalized, mode: "insensitive" } },
    { toRecipients: { contains: normalized, mode: "insensitive" } },
    { ccRecipients: { contains: normalized, mode: "insensitive" } },
  ];

  const candidates = await prisma.emailThread.findMany({
    where: {
      ...visibleEmailThreadWhere(userId),
      AND: await threadMatterAccessAnd(userId),
      messages: { some: { OR: matchOr } },
    },
    // Capped (one past the cap detects truncation): without it a busy
    // address pulls its entire history in one query. Recipient JSON
    // for verification comes from the message-scoped query below;
    // loading it here would scale with total mail volume in every
    // candidate thread, not with the number of actual matches.
    take: THREADS_FOR_EMAIL_CAP + 1,
    include: threadListInclude,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
  });
  const truncated = candidates.length > THREADS_FOR_EMAIL_CAP;
  if (truncated) candidates.length = THREADS_FOR_EMAIL_CAP;
  if (candidates.length === 0) return { rows: [], truncated: false };

  // Verification pass: sharpen the recipient substring hits so a
  // collision doesn't produce a false positive. Only fetches messages
  // that hit the OR at all — not every message of every thread.
  const hits = await prisma.emailMessage.findMany({
    where: {
      threadId: { in: candidates.map((t) => t.id) },
      OR: matchOr,
    },
    select: {
      threadId: true,
      fromEmail: true,
      toRecipients: true,
      ccRecipients: true,
    },
  });
  const verified = new Set<string>();
  for (const m of hits) {
    if (verified.has(m.threadId)) continue;
    const isMatch =
      m.fromEmail.toLowerCase() === normalized ||
      parseRecipients(m.toRecipients).some(
        (r) => r.email.toLowerCase() === normalized
      ) ||
      parseRecipients(m.ccRecipients).some(
        (r) => r.email.toLowerCase() === normalized
      );
    if (isMatch) verified.add(m.threadId);
  }

  return {
    rows: candidates.filter((t) => verified.has(t.id)).map(toThreadListRow),
    truncated,
  };
}

export type CommunicationCounts = {
  inbox: number;
  all: number;
  unread: number;
  starred: number;
  archived: number;
  unfiled: number;
  filed: number;
  untimed: number;
};

type CheapEmailCountsRow = {
  inbox: number;
  all: number;
  unread: number;
  starred: number;
  archived: number;
  unfiled: number;
  filed: number;
};

/**
 * Rail counts. The seven cheap, row-local counts come from ONE
 * conditional-aggregate scan of the viewer's threads (each FILTER
 * mirrors the matching `listThreads` filter - keep them in step); the
 * `untimed` anti-join stays a separate count. Raw SQL uses the mapped
 * table / column names.
 *
 * MAILBOX SCOPE: the raw SQL cannot spread `visibleEmailThreadWhere`
 * (src/lib/email-visibility.ts), so the `JOIN email_accounts ...
 * WHERE a."userId"` below is a hand-written copy of that scope. If the
 * helper ever widens (shared mailbox flag, etc.) this query MUST change
 * with it. The real-database tests in communication.test.ts execute
 * this SQL (mailbox-scoping and "every rail count equals its list"
 * cases), so a column / FILTER drift fails there.
 */
export async function getCommunicationCounts(): Promise<CommunicationCounts> {
  const userId = await getCurrentUserId();
  const now = new Date();
  const accessSql = await threadMatterAccessSql(userId);
  const accessAnd = await threadMatterAccessAnd(userId);
  const [cheap, untimed] = await Promise.all([
    prisma.$queryRaw<CheapEmailCountsRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE t."isArchived" = false
            AND (t."followUpAt" IS NULL OR t."followUpAt" <= ${now})
        )::int AS inbox,
        COUNT(*)::int AS "all",
        COUNT(*) FILTER (
          WHERE t."isRead" = false AND t."isArchived" = false
        )::int AS unread,
        COUNT(*) FILTER (WHERE t."isStarred" = true)::int AS starred,
        COUNT(*) FILTER (WHERE t."isArchived" = true)::int AS archived,
        COUNT(*) FILTER (WHERE t."matterId" IS NULL)::int AS unfiled,
        COUNT(*) FILTER (WHERE t."matterId" IS NOT NULL)::int AS filed
      FROM email_threads t
      JOIN email_accounts a ON a.id = t."accountId"
      -- Keep in step with visibleEmailThreadWhere (email-visibility.ts).
      WHERE a."userId" = ${userId}
      ${accessSql}
    `),
    prisma.emailThread.count({
      where: {
        ...visibleEmailThreadWhere(userId),
        AND: accessAnd,
        messages: { none: { timeEntries: { some: { userId } } } },
      },
    }),
  ]);
  const row = cheap[0];
  return {
    inbox: row?.inbox ?? 0,
    all: row?.all ?? 0,
    unread: row?.unread ?? 0,
    starred: row?.starred ?? 0,
    archived: row?.archived ?? 0,
    unfiled: row?.unfiled ?? 0,
    filed: row?.filed ?? 0,
    untimed,
  };
}

/** Unread (non-archived) threads in the viewer's mailbox - the Email
 *  tab badge. One cheap count for when the messages view needs only
 *  this number rather than every rail count. Same rule as the rail's
 *  Unread count and the sidebar badge. */
export async function getEmailUnreadCount(): Promise<number> {
  const userId = await getCurrentUserId();
  return prisma.emailThread.count({
    where: {
      ...visibleEmailThreadWhere(userId),
      AND: await threadMatterAccessAnd(userId),
      isRead: false,
      isArchived: false,
    },
  });
}

/** Compact matter row used by the file-to-matter picker on the
 *  email thread reader. Open matters only; pinned ones bubble to
 *  the top so the most-likely targets are at hand. */
export type FilingMatterOption = {
  id: string;
  name: string;
  color: string;
  area: string;
  isPinned: boolean;
};

export async function getFilingMatterOptions(): Promise<FilingMatterOption[]> {
  const userId = await getCurrentUserId();
  const [matters, pins] = await Promise.all([
    prisma.matter.findMany({
      where: {
        ...(await matterAccessWhere(userId)),
        isArchived: false,
        stage: { isTerminal: false },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        color: true,
        practiceArea: { select: { name: true } },
      },
    }),
    prisma.userMatterPin.findMany({
      where: { userId },
      select: { matterId: true },
    }),
  ]);
  const pinnedSet = new Set(pins.map((p) => p.matterId));
  // Stable sort: pinned first, then most-recently-updated.
  return matters
    .map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      area: m.practiceArea.name,
      isPinned: pinnedSet.has(m.id),
    }))
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return 0;
    });
}

/**
 * The Inbox filter's visibility predicate: not archived AND not
 * snoozed for later. followUpAt = null → never snoozed; followUpAt <=
 * now → the snooze has expired and the thread reappears. Shared by
 * the Inbox list and the pinned-matter rail badges so a badge count
 * always equals the rows the (default Inbox) link opens.
 */
function inboxVisibilityWhere(now: Date = new Date()) {
  return {
    isArchived: false,
    OR: [{ followUpAt: null }, { followUpAt: { lte: now } }],
  };
}

/** Pinned matter + thread count for the communication rail's
 *  per-matter drilldown section. Every non-archived pin is returned,
 *  including ones with zero threads (the page resolves its matter
 *  label from this list). The count is every thread filed to the
 *  matter in the viewer's mailbox — archived and snoozed included —
 *  because the drilldown opens on the "all" filter
 *  (defaultEmailFilter(matterId)): filed mail is the case record. */
export type CommPinnedMatter = {
  id: string;
  name: string;
  color: string;
  area: string;
  threadCount: number;
};

export async function getCommunicationPinnedMatters(): Promise<
  CommPinnedMatter[]
> {
  const userId = await getCurrentUserId();
  const pins = await prisma.userMatterPin.findMany({
    where: {
      userId,
      matter: { ...(await matterAccessWhere(userId)), isArchived: false },
    },
    orderBy: { createdAt: "desc" },
    select: {
      matter: {
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
        },
      },
    },
  });
  if (pins.length === 0) return [];

  const matterIds = pins.map((p) => p.matter.id);
  const counts = await prisma.emailThread.groupBy({
    by: ["matterId"],
    where: {
      ...visibleEmailThreadWhere(userId),
      matterId: { in: matterIds },
    },
    _count: true,
  });
  const countMap = new Map(counts.map((c) => [c.matterId, c._count]));

  return pins.map((p) => ({
    id: p.matter.id,
    name: p.matter.name,
    color: p.matter.color,
    area: p.matter.practiceArea.name,
    threadCount: countMap.get(p.matter.id) ?? 0,
  }));
}
