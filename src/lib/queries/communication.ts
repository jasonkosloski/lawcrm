/**
 * Communication Queries
 *
 * Server-only data access for the unified-inbox /communication page.
 * Email-first today; SMS queries will slot in alongside when the
 * integration lands (see SCHEMA_NOTES open question on Email* vs.
 * polymorphic Communication*).
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export type CommunicationFilter =
  /** Default working surface: unarchived threads that aren't
   *  snoozed (followUpAt in the future hides until the date
   *  arrives). This is what most users want most of the time. */
  | "inbox"
  /** Everything, including archived + snoozed. */
  | "all"
  | "unread"
  | "starred"
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
  hasAttachments: boolean;
  messageCount: number;
  lastMessageAt: Date;
  /** Snooze date when set — surfaces as a chip on the row. */
  followUpAt: Date | null;
  /** First sender in the thread — typically "who's emailing me". */
  fromDisplay: string;
  matter: { id: string; name: string; color: string } | null;
};

export async function listThreads(
  filter: CommunicationFilter = "all",
  /** When set, filters to threads on this specific matter — used by
   *  the per-pinned-matter sub-rail entries. Overrides matter-related
   *  filters. */
  matterId?: string
): Promise<ThreadListRow[]> {
  const userId = await getCurrentUserId();

  // `where` builds from the filter, but always scoped to the current
  // user's accounts.
  const where: Record<string, unknown> = {
    account: { userId },
  };
  if (filter === "unread") where.isRead = false;
  if (filter === "starred") where.isStarred = true;
  if (filter === "unfiled") where.matterId = null;
  if (filter === "filed") where.matterId = { not: null };
  if (filter === "untimed") {
    // No message in this thread has a time entry by the current user.
    // Other users' time entries don't disqualify — this is "what
    // I haven't billed yet" for me specifically.
    where.messages = {
      none: { timeEntries: { some: { userId } } },
    };
  }
  if (filter === "inbox") {
    // Working inbox: not archived AND not snoozed for later.
    // followUpAt = null → never snoozed; followUpAt <= now → snooze
    // has expired and the thread should reappear.
    where.isArchived = false;
    where.OR = [
      { followUpAt: null },
      { followUpAt: { lte: new Date() } },
    ];
  }
  // Per-pinned-matter override — wins over any matter-related filter.
  if (matterId) where.matterId = matterId;

  const threads = await prisma.emailThread.findMany({
    where,
    // 500-thread cap on the inbox — matches how Gmail / Outlook
    // both default to "most recent N" without a true infinite
    // scroll. Build proper paging when a real firm exceeds this.
    take: 500,
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 1,
        select: { fromName: true, fromEmail: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    followUpAt: t.followUpAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
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
    where: { id, account: { userId } },
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
  matterId: string
): Promise<ThreadListRow[]> {
  const userId = await getCurrentUserId();
  const threads = await prisma.emailThread.findMany({
    where: { matterId, account: { userId } },
    // 500-thread cap matches listThreads. A single matter rarely
    // exceeds this; if one does, build per-matter paging.
    take: 500,
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 1,
        select: { fromName: true, fromEmail: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    followUpAt: t.followUpAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
}

/** Threads that touch a given email address (sender OR recipient).
 *  Recipients are stored as JSON strings so the final filter runs in
 *  memory after fetching the candidate set.
 *
 *  Used by the lead Communication tab — since Leads don't have direct
 *  EmailThread links today, email address is the matching key. Schema
 *  may eventually gain a `Lead.threadId[]` relation (see SCHEMA_NOTES
 *  open questions) at which point this becomes a direct join. */
export async function listThreadsForEmail(
  email: string
): Promise<ThreadListRow[]> {
  if (!email) return [];
  const normalized = email.toLowerCase();
  const userId = await getCurrentUserId();

  // Quick candidate fetch: any thread with a message that sent to or
  // from the email (via substring hit on toRecipients/ccRecipients
  // JSON, or exact on fromEmail).
  const candidates = await prisma.emailThread.findMany({
    where: {
      account: { userId },
      messages: {
        some: {
          OR: [
            { fromEmail: { contains: normalized } },
            { toRecipients: { contains: normalized } },
            { ccRecipients: { contains: normalized } },
          ],
        },
      },
    },
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          fromName: true,
          fromEmail: true,
          toRecipients: true,
          ccRecipients: true,
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  // Sharpen the match in memory so a substring collision doesn't
  // produce a false positive.
  const matches = candidates.filter((t) =>
    t.messages.some((m) => {
      if (m.fromEmail.toLowerCase() === normalized) return true;
      const to = parseRecipients(m.toRecipients);
      if (to.some((r) => r.email.toLowerCase() === normalized)) return true;
      const cc = parseRecipients(m.ccRecipients);
      return cc.some((r) => r.email.toLowerCase() === normalized);
    })
  );

  return matches.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    followUpAt: t.followUpAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
}

export type CommunicationCounts = {
  inbox: number;
  all: number;
  unread: number;
  starred: number;
  unfiled: number;
  filed: number;
  untimed: number;
};

export async function getCommunicationCounts(): Promise<CommunicationCounts> {
  const userId = await getCurrentUserId();
  const base = { account: { userId } };
  const now = new Date();
  const [inbox, all, unread, starred, unfiled, filed, untimed] =
    await Promise.all([
      prisma.emailThread.count({
        where: {
          ...base,
          isArchived: false,
          OR: [{ followUpAt: null }, { followUpAt: { lte: now } }],
        },
      }),
      prisma.emailThread.count({ where: base }),
      prisma.emailThread.count({ where: { ...base, isRead: false } }),
      prisma.emailThread.count({ where: { ...base, isStarred: true } }),
      prisma.emailThread.count({ where: { ...base, matterId: null } }),
      prisma.emailThread.count({ where: { ...base, matterId: { not: null } } }),
      prisma.emailThread.count({
        where: {
          ...base,
          messages: {
            none: { timeEntries: { some: { userId } } },
          },
        },
      }),
    ]);
  return { inbox, all, unread, starred, unfiled, filed, untimed };
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
      where: { isArchived: false, stage: { isTerminal: false } },
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

/** Pinned matter + thread count for the communication rail's per-
 *  matter drilldown section. Only matters that actually have at
 *  least one thread on the user's account are returned — keeps the
 *  rail tight. */
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
    where: { userId, matter: { isArchived: false } },
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
    where: { account: { userId }, matterId: { in: matterIds } },
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
