/**
 * Messenger queries.
 *
 * Server-only data access for the messenger view of /communication
 * (SMS, calls, voicemails per phone number). Email lives separately
 * in `@/lib/queries/communication.ts` since email's threading model
 * is structurally different.
 *
 * The shapes returned here are designed for direct rendering — joins
 * pre-resolve contact + matter so the UI doesn't N+1.
 */

import { prisma } from "@/lib/prisma";

export type MessengerKind = "sms" | "call" | "voicemail";
export type MessengerDirection = "inbound" | "outbound";

/** Row shape for the inbox thread list (left rail). */
export type MessengerThreadRow = {
  id: string;
  contactPhone: string;
  contactId: string | null;
  contactName: string | null;
  contactType: string | null;
  defaultMatterId: string | null;
  defaultMatterName: string | null;
  defaultMatterColor: string | null;
  /** Most recent item snippet for the inbox preview. Null on a brand-new thread. */
  lastBody: string | null;
  lastKind: MessengerKind | null;
  lastDirection: MessengerDirection | null;
  lastAt: Date;
  unreadCount: number;
  isPinned: boolean;
  isArchived: boolean;
  followUpAt: Date | null;
};

/** Row shape for an item rendered inside the thread reader (right pane). */
/** Compact view of a time entry logged on a messenger item — drives
 *  the inline time-logged indicator on SMS bubbles, call events, and
 *  voicemail cards. */
export type MessengerItemTime = {
  id: string;
  hours: number;
  date: Date;
  activity: string;
  userName: string;
  userInitials: string;
  billable: boolean;
};

export type MessengerItemRow = {
  id: string;
  kind: MessengerKind;
  direction: MessengerDirection;
  fromNumber: string;
  toNumber: string;
  body: string | null;
  mediaUrls: Array<{ url: string; contentType?: string; sizeBytes?: number }>;
  callDurationSec: number | null;
  callStatus: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  matterId: string | null;
  /** Matter name resolved at query time so rendering doesn't N+1. */
  matterName: string | null;
  matterColor: string | null;
  isRead: boolean;
  occurredAt: Date;
  /** Time entries logged "on this specific item." */
  timeEntries: MessengerItemTime[];
};

/** Detail shape returned by getMessengerThread — header + items. */
export type MessengerThreadDetail = {
  id: string;
  contactPhone: string;
  contact: {
    id: string;
    name: string;
    type: string;
    organization: string | null;
  } | null;
  defaultMatter: {
    id: string;
    name: string;
    color: string;
  } | null;
  isPinned: boolean;
  isArchived: boolean;
  followUpAt: Date | null;
  items: MessengerItemRow[];
};

const SAFE_MEDIA: MessengerItemRow["mediaUrls"] = [];

/** Best-effort cast of a Prisma JSON value into the typed mediaUrls
 *  shape. Tolerant of malformed rows — never throws. */
function parseMediaUrls(raw: unknown): MessengerItemRow["mediaUrls"] {
  if (!Array.isArray(raw)) return SAFE_MEDIA;
  return raw
    .filter(
      (m): m is { url: string } =>
        typeof m === "object" && m !== null && typeof (m as { url: unknown }).url === "string"
    )
    .map((m) => ({
      url: (m as { url: string }).url,
      contentType: (m as { contentType?: string }).contentType,
      sizeBytes: (m as { sizeBytes?: number }).sizeBytes,
    }));
}

/**
 * Inbox: messenger threads ordered by last activity. Filters:
 *   - filter "all" (default), "unread", "unfiled" (no defaultMatter
 *     and no item-level matter), "pinned"
 *   - matterId for the matter-detail Communication tab
 *
 * Returns a denormalized row shape (contact + matter joined) so the
 * left rail can render directly without per-row lookups.
 */
export async function listMessengerThreads({
  filter = "all",
  matterId,
  contactPhone,
  take = 200,
}: {
  filter?: "all" | "unread" | "unfiled" | "pinned";
  matterId?: string;
  /** Exact-match (E.164) filter — used by the lead Communication
   *  tab to scope to one phone number. */
  contactPhone?: string;
  take?: number;
} = {}): Promise<MessengerThreadRow[]> {
  const threads = await prisma.messengerThread.findMany({
    where: {
      isArchived: false,
      ...(filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
      ...(filter === "pinned" ? { isPinned: true } : {}),
      ...(filter === "unfiled" ? { defaultMatterId: null } : {}),
      ...(matterId
        ? {
            OR: [
              { defaultMatterId: matterId },
              { items: { some: { matterId } } },
            ],
          }
        : {}),
      ...(contactPhone ? { contactPhone } : {}),
    },
    orderBy: [{ isPinned: "desc" }, { lastItemAt: "desc" }],
    take,
    include: {
      contact: { select: { id: true, name: true, type: true } },
      defaultMatter: { select: { id: true, name: true, color: true } },
      items: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: {
          body: true,
          kind: true,
          direction: true,
          callStatus: true,
        },
      },
    },
  });

  return threads.map((t) => {
    const last = t.items[0];
    // Derive a sensible preview snippet for calls (no body).
    const lastBody =
      last?.body ??
      (last?.kind === "call"
        ? last.callStatus === "missed"
          ? "Missed call"
          : last.direction === "inbound"
            ? "Inbound call"
            : "Outbound call"
        : last?.kind === "voicemail"
          ? "Voicemail"
          : null);
    return {
      id: t.id,
      contactPhone: t.contactPhone,
      contactId: t.contactId,
      contactName: t.contact?.name ?? null,
      contactType: t.contact?.type ?? null,
      defaultMatterId: t.defaultMatterId,
      defaultMatterName: t.defaultMatter?.name ?? null,
      defaultMatterColor: t.defaultMatter?.color ?? null,
      lastBody,
      lastKind: (last?.kind ?? null) as MessengerKind | null,
      lastDirection: (last?.direction ?? null) as MessengerDirection | null,
      lastAt: t.lastItemAt,
      unreadCount: t.unreadCount,
      isPinned: t.isPinned,
      isArchived: t.isArchived,
      followUpAt: t.followUpAt,
    };
  });
}

/** Normalize a US phone string for matching: strips everything but
 *  digits, then prepends `+1` for the common 10-digit case so the
 *  result lines up with E.164-stored thread.contactPhone. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Threads scoped to a phone number — used by the lead Communication
 * tab. Falls back to digit-only comparison so seeded `(303) 555-0182`
 * matches stored `+13035550182` even before normalization migration.
 */
export async function listMessengerThreadsForPhone(
  phone: string
): Promise<MessengerThreadRow[]> {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return listMessengerThreads({ contactPhone: normalized });
}

/** Counts for the mailbox rail on the messenger view. */
export type MessengerMailboxCounts = {
  all: number;
  unread: number;
  unfiled: number;
  pinned: number;
};

export async function getMessengerMailboxCounts(): Promise<MessengerMailboxCounts> {
  const [all, unread, unfiled, pinned] = await Promise.all([
    prisma.messengerThread.count({ where: { isArchived: false } }),
    prisma.messengerThread.count({
      where: { isArchived: false, unreadCount: { gt: 0 } },
    }),
    prisma.messengerThread.count({
      where: { isArchived: false, defaultMatterId: null },
    }),
    prisma.messengerThread.count({
      where: { isArchived: false, isPinned: true },
    }),
  ]);
  return { all, unread, unfiled, pinned };
}

/**
 * Full thread + items for the right pane reader. Null when missing
 * so the page can `notFound()`.
 */
export async function getMessengerThread(
  threadId: string
): Promise<MessengerThreadDetail | null> {
  const t = await prisma.messengerThread.findUnique({
    where: { id: threadId },
    include: {
      contact: {
        select: { id: true, name: true, type: true, organization: true },
      },
      defaultMatter: { select: { id: true, name: true, color: true } },
      items: {
        orderBy: { occurredAt: "asc" },
        include: {
          matter: { select: { id: true, name: true, color: true } },
          // Per-item time entries — drives the inline indicator
          // chip on SMS bubbles, call events, and voicemail cards.
          timeEntries: {
            include: { user: { select: { name: true, initials: true } } },
            orderBy: { date: "asc" },
          },
        },
      },
    },
  });
  if (!t) return null;

  return {
    id: t.id,
    contactPhone: t.contactPhone,
    contact: t.contact,
    defaultMatter: t.defaultMatter,
    isPinned: t.isPinned,
    isArchived: t.isArchived,
    followUpAt: t.followUpAt,
    items: t.items.map((i) => ({
      id: i.id,
      kind: i.kind as MessengerKind,
      direction: i.direction as MessengerDirection,
      fromNumber: i.fromNumber,
      toNumber: i.toNumber,
      body: i.body,
      mediaUrls: parseMediaUrls(i.mediaUrls),
      callDurationSec: i.callDurationSec,
      callStatus: i.callStatus,
      recordingUrl: i.recordingUrl,
      transcript: i.transcript,
      matterId: i.matterId,
      matterName: i.matter?.name ?? null,
      matterColor: i.matter?.color ?? null,
      isRead: i.isRead,
      occurredAt: i.occurredAt,
      timeEntries: i.timeEntries.map((te) => ({
        id: te.id,
        hours: te.hours,
        date: te.date,
        activity: te.activity,
        userName: te.user.name,
        userInitials: te.user.initials,
        billable: te.billable,
      })),
    })),
  };
}

/** Item-level row for the matter-detail Phone channel — one entry
 *  per call / SMS / voicemail filed to the matter, with the thread's
 *  contact resolved for display and `threadId` for the link back to
 *  the full reader on /communication. */
export type MatterMessengerItemRow = {
  id: string;
  threadId: string;
  kind: MessengerKind;
  direction: MessengerDirection;
  callStatus: string | null;
  callDurationSec: number | null;
  /** SMS body / call summary / voicemail transcript fallback. */
  body: string | null;
  contactName: string | null;
  contactPhone: string;
  occurredAt: Date;
};

/**
 * Calls + messages filed to a matter, newest first. An item counts
 * as filed when it carries the matter directly (`item.matterId`) or
 * inherits it from its thread's default routing (`item.matterId`
 * null + `thread.defaultMatterId` matches) — the same resolution
 * rule the reader uses.
 */
export async function listMessengerItemsForMatter(
  matterId: string,
  take = 100
): Promise<MatterMessengerItemRow[]> {
  const items = await prisma.messengerItem.findMany({
    where: {
      OR: [
        { matterId },
        { matterId: null, thread: { defaultMatterId: matterId } },
      ],
    },
    orderBy: { occurredAt: "desc" },
    take,
    select: {
      id: true,
      threadId: true,
      kind: true,
      direction: true,
      callStatus: true,
      callDurationSec: true,
      body: true,
      transcript: true,
      occurredAt: true,
      thread: {
        select: {
          contactPhone: true,
          contact: { select: { name: true } },
        },
      },
    },
  });
  return items.map((i) => ({
    id: i.id,
    threadId: i.threadId,
    kind: i.kind as MessengerKind,
    direction: i.direction as MessengerDirection,
    callStatus: i.callStatus,
    callDurationSec: i.callDurationSec,
    body: i.body ?? i.transcript,
    contactName: i.thread.contact?.name ?? null,
    contactPhone: i.thread.contactPhone,
    occurredAt: i.occurredAt,
  }));
}
