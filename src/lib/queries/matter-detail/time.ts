/**
 * Matter Detail — Time tab readers (entries + summary).
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";
import { EVENT_REF_SELECT, scrubEventRef } from "./shared";
import { EntitySource, AttachedNotePreview, resolveEntitySource } from "./tasks";

// ── Time entries ─────────────────────────────────────────────────────────

export type TimeEntryRow = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  utbmsCode: string | null;
  rate: number | null;
  amount: number | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  source: string;
  status: string;
  /** Author id - lets the Time tab hide edit/delete from users who
   *  are neither the author nor hold the `_any` permission. */
  userId: string;
  userName: string;
  userInitials: string;
  invoiceId: string | null;
  /** Where this entry was logged from: a note, an email message, a
   *  messenger item, a task, a deadline or a calendar event (event
   *  titles are scrubbed to "Busy" for viewers who can't see them).
   *  Same field shape as TaskRow / DeadlineRow for chip-render reuse. */
  spawnedFrom: EntitySource | null;
  attachedNotes: AttachedNotePreview[];
};

export type MatterTimeSummary = {
  totalHours: number;
  billableHours: number;
  unbilledAmount: number;
  billedAmount: number;
};

/// Cap how many rows the Time tab pulls in one shot — same number
/// as MATTER_ACTIVITY_LIMIT on the timeline. Long-running hourly
/// matters accumulate thousands of entries, and each row here drags
/// eight relation includes (note bodies included); entries past the
/// cap need the eventual load-more / paginated viewer. Totals are
/// NOT affected — getMatterTimeSummary aggregates in the database
/// over every row.
const MATTER_TIME_ENTRIES_LIMIT = 200;

export async function getMatterTimeEntries(
  matterId: string,
  options: { limit?: number } = {},
): Promise<TimeEntryRow[]> {
  const viewerId = await getCurrentUserId();
  const rows = await prisma.timeEntry.findMany({
    where: { matterId },
    take: options.limit ?? MATTER_TIME_ENTRIES_LIMIT,
    include: {
      user: { select: { name: true, initials: true } },
      parentNote: { select: { id: true, content: true } },
      parentTask: { select: { id: true, title: true } },
      parentDeadline: { select: { id: true, title: true } },
      // Time logged from the Events tab (calendarEventId) — the chip
      // label obeys the same Busy rule as every other event reference.
      event: { select: EVENT_REF_SELECT },
      // Per-individual-comm sources: time entries logged on a
      // single email message or messenger item. Resolved into the
      // existing email/message EntitySource kinds for chip render.
      emailMessage: {
        select: {
          id: true,
          fromName: true,
          thread: { select: { id: true, subject: true } },
        },
      },
      messengerItem: {
        select: {
          id: true,
          kind: true,
          thread: {
            select: {
              id: true,
              contactPhone: true,
              contact: { select: { name: true } },
            },
          },
        },
      },
      notes: {
        select: {
          id: true,
          content: true,
          type: true,
          createdAt: true,
          author: { select: { name: true, initials: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    date: e.date,
    hours: e.hours,
    activity: e.activity,
    narrative: e.narrative,
    utbmsCode: e.utbmsCode,
    // Decimal → number at the API boundary. Same pattern as Matter.trustBalance.
    rate: e.rate?.toNumber() ?? null,
    amount: e.amount?.toNumber() ?? null,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    source: e.source,
    status: e.status,
    userId: e.userId,
    userName: e.user.name,
    userInitials: e.user.initials,
    invoiceId: e.invoiceId,
    spawnedFrom: resolveEntitySource({
      note: e.parentNote,
      // Resolve the per-message source up to the thread for the chip
      // href — there's no per-message detail URL today.
      email: e.emailMessage
        ? {
            id: e.emailMessage.thread.id,
            subject: `${e.emailMessage.thread.subject} (${e.emailMessage.fromName})`,
          }
        : null,
      messenger: e.messengerItem,
      event: scrubEventRef(e.event, viewerId),
      task: e.parentTask,
      deadline: e.parentDeadline,
    }),
    attachedNotes: e.notes.map((n) => ({
      id: n.id,
      content: sanitizeUserHtml(n.content),
      type: n.type,
      authorName: n.author.name,
      authorInitials: n.author.initials,
      createdAt: n.createdAt,
    })),
  }));
}

export async function getMatterTimeSummary(matterId: string): Promise<MatterTimeSummary> {
  // Aggregate in the database instead of fetching rows: the summary
  // must cover EVERY entry the matter ever had (unlike the capped
  // list above), so its cost can't be allowed to grow with row
  // count. groupBy hands back at most billable × noCharge × status
  // buckets (~20) regardless of how many entries exist, and the
  // per-bucket amount sums are computed in Decimal by Postgres —
  // no float accumulation across rows.
  const grouped = await prisma.timeEntry.groupBy({
    by: ["status", "billable", "noCharge"],
    where: { matterId },
    _sum: { hours: true, amount: true },
  });

  let totalHours = 0;
  let billableHours = 0;
  let unbilledAmount = 0;
  let billedAmount = 0;
  for (const g of grouped) {
    const hours = g._sum.hours ?? 0;
    totalHours += hours;
    if (g.billable && !g.noCharge) {
      billableHours += hours;
      // _sum.amount is Prisma.Decimal | null. Convert to number for
      // the running totals — one rounding per bucket is irrelevant;
      // the canonical money lives in the Decimal column.
      const amount = g._sum.amount?.toNumber() ?? 0;
      // Same WIP set the Billing tab uses; written-off entries are in
      // neither bucket. ("billed" = attached to an invoice, draft or
      // sent.)
      if (g.status === "billed") billedAmount += amount;
      else if ((TIME_ENTRY_WIP_STATUSES as readonly string[]).includes(g.status))
        unbilledAmount += amount;
    }
  }
  return { totalHours, billableHours, unbilledAmount, billedAmount };
}
