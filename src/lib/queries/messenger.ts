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

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { matterAccessWhere } from "@/lib/matter-access";
import { isManualCallLog, isMissedCall } from "@/lib/call-log-form";
import type { CommTimeEntry } from "@/lib/queries/communication";

// The missed-call rule lives in the pure call-log-form module so the
// inbox list, the thread reader and the matter Phone log share one
// definition. Re-exported here for existing importers.
export { MISSED_CALL_STATUSES, isMissedCall } from "@/lib/call-log-form";

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
  /** Raw call status of the most recent item (see MessengerItem.callStatus:
   *  answered | missed | voicemail | busy | failed | no_answer | declined).
   *  Null for SMS or brand-new threads. Lets the UI detect missed calls
   *  from the real status instead of parsing the preview string. */
  lastCallStatus: string | null;
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
export type MessengerItemTime = CommTimeEntry;

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
  /** Manually logged (providerEventId `manual-` prefix) — only these
   *  get edit/delete affordances; provider items are immutable. */
  isManual: boolean;
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

/** "Unfiled" thread: no default matter AND no item filed to a matter.
 *  Manually logged calls are filed per item (the thread carries no
 *  default), so item-level filing must count. Shared by the list
 *  filter and the rail count so they cannot drift. */
const UNFILED_THREAD_WHERE: Prisma.MessengerThreadWhereInput = {
  defaultMatterId: null,
  items: { none: { matterId: { not: null } } },
};

/**
 * Ethical walls for the (firm-shared) messenger inbox: a thread whose
 * default matter is hidden from the viewer disappears (unfiled threads
 * stay). `{}` when the viewer sees every matter.
 */
async function threadAccessWhere(
  userId: string
): Promise<Prisma.MessengerThreadWhereInput> {
  const access = await matterAccessWhere(userId);
  if (Object.keys(access).length === 0) return {};
  return { OR: [{ defaultMatterId: null }, { defaultMatter: access }] };
}

/** Same, for items filed directly to a matter. */
async function itemAccessWhere(
  userId: string
): Promise<Prisma.MessengerItemWhereInput> {
  const access = await matterAccessWhere(userId);
  if (Object.keys(access).length === 0) return {};
  return { OR: [{ matterId: null }, { matter: access }] };
}

/** Inbox page size — no pager yet (see docs/features/communication-email.md). */
const THREAD_LIST_LIMIT = 200;

/**
 * Inbox: messenger threads ordered by last activity. Filters:
 *   - filter "all" (default), "unread", "unfiled" (no defaultMatter
 *     and no item-level matter), "pinned"
 *   - contactPhone / contactPhones / contactId scope to one person's
 *     threads (the lead Communication tab); they OR together.
 *
 * Returns a denormalized row shape (contact + matter joined) so the
 * left rail can render directly without per-row lookups.
 */
export async function listMessengerThreads({
  filter = "all",
  contactPhone,
  contactPhones,
  contactId,
}: {
  filter?: "all" | "unread" | "unfiled" | "pinned";
  /** Exact-match (E.164) filter. */
  contactPhone?: string;
  /** Exact-match (E.164) filter over several numbers. */
  contactPhones?: string[];
  /** Threads resolved to this contact, whatever number they use. */
  contactId?: string;
} = {}): Promise<MessengerThreadRow[]> {
  const userId = await getCurrentUserId();
  const threadAccess = await threadAccessWhere(userId);
  const itemAccess = await itemAccessWhere(userId);
  const scope: Prisma.MessengerThreadWhereInput[] = [];
  if (contactPhone) scope.push({ contactPhone });
  if (contactPhones?.length) scope.push({ contactPhone: { in: contactPhones } });
  if (contactId) scope.push({ contactId });

  const threads = await prisma.messengerThread.findMany({
    where: {
      isArchived: false,
      ...(filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
      ...(filter === "pinned" ? { isPinned: true } : {}),
      ...(filter === "unfiled" ? UNFILED_THREAD_WHERE : {}),
      AND: [threadAccess, ...(scope.length ? [{ OR: scope }] : [])],
    },
    orderBy: [{ isPinned: "desc" }, { lastItemAt: "desc" }],
    take: THREAD_LIST_LIMIT,
    include: {
      contact: { select: { id: true, name: true, type: true } },
      defaultMatter: { select: { id: true, name: true, color: true } },
      items: {
        where: itemAccess,
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
        ? isMissedCall(last.direction ?? null, last.callStatus)
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
      lastCallStatus: last?.callStatus ?? null,
      lastAt: t.lastItemAt,
      unreadCount: t.unreadCount,
      isPinned: t.isPinned,
      isArchived: t.isArchived,
      followUpAt: t.followUpAt,
    };
  });
}

/**
 * Normalize a typed/stored phone string to the E.164 form thread keys
 * use. Accepts a US number (10 digits, or 11 starting with 1) in any
 * punctuation, an optional trailing extension ("x123", "ext. 4"), or
 * an explicit international "+" number of 8-15 digits. Anything else
 * (7-digit local numbers, junk like "n/a") returns null so callers can
 * ask for a real number instead of minting a thread that no later
 * lookup would ever match.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withoutExt = raw
    .trim()
    .replace(/\s*(?:x|ext\.?|extension|#)\s*\d+\s*$/i, "");
  const digits = withoutExt.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (withoutExt.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

/**
 * Threads for a lead's contact - used by the lead Communication tab.
 * Matches threads resolved to the contact (`contactId`, which is what
 * "Log call" sets whatever number was typed) OR sitting on any of the
 * contact's known numbers (so webhook threads not yet resolved to the
 * contact still show).
 */
export async function listMessengerThreadsForLead({
  contactId,
  phones,
}: {
  contactId?: string | null;
  phones: Array<string | null | undefined>;
}): Promise<MessengerThreadRow[]> {
  const numbers = [
    ...new Set(
      phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p)
    ),
  ];
  if (!contactId && numbers.length === 0) return [];
  return listMessengerThreads({
    contactPhones: numbers,
    contactId: contactId ?? undefined,
  });
}

/** Counts for the mailbox rail on the messenger view. */
export type MessengerMailboxCounts = {
  all: number;
  unread: number;
  unfiled: number;
  pinned: number;
};

export async function getMessengerMailboxCounts(): Promise<MessengerMailboxCounts> {
  const acc = await threadAccessWhere(await getCurrentUserId());
  const [all, unread, unfiled, pinned] = await Promise.all([
    prisma.messengerThread.count({ where: { isArchived: false, ...acc } }),
    prisma.messengerThread.count({
      where: { isArchived: false, unreadCount: { gt: 0 }, ...acc },
    }),
    prisma.messengerThread.count({
      where: { isArchived: false, ...UNFILED_THREAD_WHERE, ...acc },
    }),
    prisma.messengerThread.count({
      where: { isArchived: false, isPinned: true, ...acc },
    }),
  ]);
  return { all, unread, unfiled, pinned };
}

/** Unread conversations (the Messages tab badge) - one cheap count
 *  for when the email view needs only the other family's badge. */
export async function getMessengerUnreadCount(): Promise<number> {
  const acc = await threadAccessWhere(await getCurrentUserId());
  return prisma.messengerThread.count({
    where: { isArchived: false, unreadCount: { gt: 0 }, ...acc },
  });
}

/**
 * Full thread + items for the right pane reader. Null when the id
 * matches no thread - the page then renders the empty reader rather
 * than a 404.
 */
export async function getMessengerThread(
  threadId: string
): Promise<MessengerThreadDetail | null> {
  const userId = await getCurrentUserId();
  const t = await prisma.messengerThread.findFirst({
    where: { AND: [{ id: threadId }, await threadAccessWhere(userId)] },
    include: {
      contact: {
        select: { id: true, name: true, type: true, organization: true },
      },
      defaultMatter: { select: { id: true, name: true, color: true } },
      items: {
        where: await itemAccessWhere(userId),
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
      isManual: isManualCallLog(i.providerEventId),
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
  /** Item-level filing only (null may still inherit the thread's
   *  default matter — that inheritance is what put it in this list). */
  matterId: string | null;
  /** Manually logged (providerEventId `manual-` prefix) — only these
   *  get edit/delete affordances; provider items are immutable. */
  isManual: boolean;
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
      providerEventId: true,
      kind: true,
      direction: true,
      callStatus: true,
      callDurationSec: true,
      body: true,
      transcript: true,
      matterId: true,
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
    matterId: i.matterId,
    isManual: isManualCallLog(i.providerEventId),
    contactName: i.thread.contact?.name ?? null,
    contactPhone: i.thread.contactPhone,
    occurredAt: i.occurredAt,
  }));
}
