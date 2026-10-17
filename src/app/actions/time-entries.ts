/**
 * Time entry server actions.
 *
 * The matter Time tab's full `createTimeEntryWithCaptures` lives in
 * captures.ts (primary + attached siblings). These narrower actions
 * are for in-place creation from other surfaces — the event-scoped
 * "log time for this event" composer on the Events tab + event
 * detail modal, and the lead-scoped intake composer on
 * /intake/[id]/time (`createLeadTimeEntry`).
 *
 * Scope invariant: every entry is EXACTLY ONE of matter-scoped or
 * lead-scoped (see src/lib/time-entry-scope.ts). The edit / status /
 * delete actions below work on either scope and revalidate the
 * matching surface via `revalidateEntryScope`.
 *
 * Accepts calendarEventId so the server links the entry directly to
 * the event; revalidation reaches back into the calendar and matter
 * events tab so both UIs reflect the new row immediately.
 *
 * Auth: `create` gated on `time_entries.create`. Edit + delete gate
 * on author-or-`time_entries.edit_any` / `delete_any` — loggers can
 * always touch their own entries; crossing the ownership line needs
 * the explicit permission. Admins short-circuit either path.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/money";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only input ("YYYY-MM-DD") is stored as UTC midnight and read
// in UTC on every surface (ADR-012) — never apply a time zone to it.
import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import {
  TIME_ENTRY_STATUSES,
  type TimeEntryStatus,
} from "@/lib/constants/time-entry-status";
import type { TimeEntryFormState } from "@/lib/time-entry-constants";
import { timeEntryFields } from "@/lib/time-entry-schema";
import { assertTimeEntryScope } from "@/lib/time-entry-scope";
import type { LeadStage } from "@/lib/constants/lead-stage";

// Typed against the centralized LeadStage union so a typo can't
// silently let post-conversion intake logging through (leads.ts
// pattern).
const CONVERTED = "converted" satisfies LeadStage;

/** Revalidate every surface that renders the entry, for either side
 *  of the exactly-one-of scope invariant: the matter Time tab (+
 *  overview, + events/calendar when event-linked) or the lead's
 *  intake Time tab (+ lead overview). */
function revalidateEntryScope(entry: {
  matterId: string | null;
  leadId: string | null;
  calendarEventId?: string | null;
}): void {
  if (entry.matterId) {
    revalidatePath(`/matters/${entry.matterId}/time`);
    revalidatePath(`/matters/${entry.matterId}`);
    if (entry.calendarEventId) {
      revalidatePath(`/matters/${entry.matterId}/events`);
      revalidatePath(`/calendar`);
    }
  } else if (entry.leadId) {
    revalidatePath(`/intake/${entry.leadId}/time`);
    revalidatePath(`/intake/${entry.leadId}`);
  }
}

const BILLED_BY_INVOICE_ERROR =
  "Entries are marked billed by invoice generation. Add this entry to an invoice instead.";

const timeEntrySchema = z.object({
  ...timeEntryFields,
  calendarEventId: z.string().trim().optional().or(z.literal("")),
});

export async function createTimeEntry(
  matterId: string,
  _prev: TimeEntryFormState,
  formData: FormData
): Promise<TimeEntryFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  // Guard that the matter exists before writing.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) {
    return {
      status: "error",
      errors: { activity: ["Matter not found"] },
      values: raw,
    };
  }

  const date = parseDateOnly(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  // A linked event must exist AND belong to this matter (createNote
  // does the same) — otherwise a hand-posted id links the entry's
  // narrative into another matter's event modal, and a stale id
  // would surface as a raw FK error instead of a field error.
  const calendarEventId = parsed.data.calendarEventId || null;
  if (calendarEventId) {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: calendarEventId },
      select: { matterId: true },
    });
    if (!event || event.matterId !== matterId) {
      return {
        status: "error",
        errors: { calendarEventId: ["Event not found on this matter"] },
        values: raw,
      };
    }
  }

  const userId = await getCurrentUserId();

  await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      utbmsCode: parsed.data.utbmsCode || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      source: calendarEventId ? "calendar" : "manual",
      calendarEventId,
    },
  });

  revalidatePath(`/matters/${matterId}/time`);
  revalidatePath(`/matters/${matterId}`);
  if (calendarEventId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/calendar`);
  }
  await logActivity({
    matterId,
    userId,
    type: "time_entry",
    title: `Time logged · ${parsed.data.hours}h`,
    // Privileged entries never copy their narrative into the
    // firm-wide activity feed.
    detail: parsed.data.privileged === "on" ? undefined : parsed.data.activity,
  });
  return { status: "ok" };
}

// ── Lead-scoped create (intake time) ────────────────────────────────────

// Same fields as the matter composer minus calendarEventId — intake
// time has no matter events to hang off of.
const leadTimeEntrySchema = timeEntrySchema.omit({ calendarEventId: true });

/**
 * "Log time on this lead" — intake calls, conflict checks,
 * evaluation work done before a matter exists. Writes a lead-scoped
 * TimeEntry (leadId set, matterId null — the exactly-one-of scope
 * invariant, asserted below). On conversion these entries are
 * re-homed onto the new matter by convertLeadToMatter.
 *
 * Converted leads are refused: their intake record already rolled
 * forward, so a late entry here would strand on the lead forever.
 * Declined leads still accept entries (wrap-up work is real firm
 * overhead worth capturing).
 */
export async function createLeadTimeEntry(
  leadId: string,
  _prev: TimeEntryFormState,
  formData: FormData
): Promise<TimeEntryFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = leadTimeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, stage: true },
  });
  if (!lead) {
    return {
      status: "error",
      errors: { activity: ["Lead no longer exists"] },
      values: raw,
    };
  }
  if (lead.stage === CONVERTED) {
    return {
      status: "error",
      errors: {
        activity: [
          "Lead is already converted — log this time on the matter instead.",
        ],
      },
      values: raw,
    };
  }

  const date = parseDateOnly(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  const userId = await getCurrentUserId();

  await prisma.timeEntry.create({
    data: {
      ...assertTimeEntryScope({ matterId: null, leadId }),
      userId,
      date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      utbmsCode: parsed.data.utbmsCode || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      source: "manual",
    },
  });

  revalidatePath(`/intake/${leadId}/time`);
  revalidatePath(`/intake/${leadId}`);
  // Lead-scoped: no matter to hang the row on (matterId null).
  await logActivity({
    matterId: null,
    userId,
    type: "time_entry",
    title: `Intake time logged · ${parsed.data.hours}h`,
    // No matter team to scope the feed row to, so no activity text.
  });
  return { status: "ok" };
}

// ── Update ──────────────────────────────────────────────────────────────

const updateTimeEntrySchema = z.object({
  ...timeEntryFields,
  // Optional with NO default: a form that omits the field must leave
  // the stored status alone (a default would silently reset a
  // billable/submitted entry to draft).
  status: z.enum(TIME_ENTRY_STATUSES).optional(),
});

/** The conditional update matched nothing: either the entry was
 *  billed between our read and write, or it was deleted. Say which. */
async function writeRefusedState(
  timeEntryId: string,
  raw: Record<string, string>
): Promise<TimeEntryFormState> {
  const now = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: { status: true },
  });
  return {
    status: "error",
    errors: {
      activity: [
        now
          ? "Entry is already billed. Unbill it before editing."
          : "Time entry no longer exists",
      ],
    },
    values: raw,
  };
}

export async function updateTimeEntry(
  timeEntryId: string,
  _prev: TimeEntryFormState,
  formData: FormData
): Promise<TimeEntryFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateTimeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: {
      matterId: true,
      leadId: true,
      userId: true,
      calendarEventId: true,
      status: true,
      rate: true,
      hours: true,
      date: true,
      billable: true,
      noCharge: true,
      privileged: true,
    },
  });
  if (!entry) {
    return {
      status: "error",
      errors: { activity: ["Time entry no longer exists"] },
      values: raw,
    };
  }

  // Author can always edit their own; otherwise require the
  // `_any` permission. Admins pass either path.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // Once a time entry is on an invoice (status: billed), the
  // accounting record is essentially closed — its hours/amount are
  // baked into the invoice's stored subtotal, and nothing here
  // recomputes that. Block unconditionally on the entry's *current*
  // status (never trust the posted status; it defaults to "draft") —
  // same posture as `deleteTimeEntry`. Legitimate corrections go
  // through `updateInvoiceLineItem`, which recomputes the invoice
  // totals in the same transaction.
  if (entry.status === "billed") {
    return {
      status: "error",
      errors: {
        activity: ["Entry is already billed. Unbill it before editing."],
      },
      values: raw,
    };
  }

  // "billed" is owned by invoice generation (same rule as
  // setTimeEntryStatus). The current-status guard above already
  // rejected billed rows, so a posted "billed" here is always a
  // manual flip that would strand the entry outside WIP and off
  // every invoice.
  if (parsed.data.status === "billed") {
    return {
      status: "error",
      errors: { status: [BILLED_BY_INVOICE_ERROR] },
      values: raw,
    };
  }

  const date = parseDateOnly(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  const newHours = Number(parsed.data.hours);

  // Conditional write: invoice generation commits `billed` +
  // invoiceId in its own transaction, and can land between the read
  // above and this write. Filtering on the status in the WHERE makes
  // the check and the write one statement, so an edit can never
  // overwrite a row that just joined an invoice.
  const written = await prisma.timeEntry.updateMany({
    where: { id: timeEntryId, status: { not: "billed" } },
    data: {
      date,
      hours: newHours,
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      utbmsCode: parsed.data.utbmsCode || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      // Only write status when the form actually posted one.
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      // Schema contract: `amount` is hours x rate, and "the action
      // that sets it is responsible for keeping it in sync". An
      // entry picks up a rate via `updateInvoiceLineItem` and keeps
      // it if the invoice is later voided - so changing hours here
      // must recompute amount or the next generateInvoiceFromWip
      // sums a stale Decimal. Null rate (contingent matters) means
      // there's no amount to sync.
      ...(entry.rate
        ? { amount: roundMoney(entry.rate.mul(new Prisma.Decimal(newHours))) }
        : {}),
    },
  });
  if (written.count === 0) return writeRefusedState(timeEntryId, raw);

  revalidateEntryScope(entry);
  const changes: string[] = [];
  if (entry.hours !== newHours) changes.push(`${entry.hours}h → ${newHours}h`);
  if (dateOnlyKey(entry.date) !== dateOnlyKey(date)) {
    changes.push(`date ${dateOnlyKey(entry.date)} → ${dateOnlyKey(date)}`);
  }
  const nextBillable = parsed.data.billable === "on";
  const nextNoCharge = parsed.data.noCharge === "on";
  if (entry.billable !== nextBillable) {
    changes.push(nextBillable ? "marked billable" : "marked non-billable");
  }
  if (entry.noCharge !== nextNoCharge) {
    changes.push(nextNoCharge ? "marked no-charge" : "no-charge cleared");
  }
  if (parsed.data.status && parsed.data.status !== entry.status) {
    changes.push(`status ${entry.status} → ${parsed.data.status}`);
  }
  await logActivity({
    matterId: entry.matterId,
    userId: actorId,
    type: "time_entry",
    title: `Time entry edited · ${newHours}h`,
    // Privileged (before or after this edit): hours/status changes
    // only, never the activity text.
    detail: (entry.privileged || parsed.data.privileged === "on"
      ? changes
      : [parsed.data.activity, ...changes]
    ).join(" · ") || undefined,
  });
  return { status: "ok" };
}

// ── Status ──────────────────────────────────────────────────────────────

export async function setTimeEntryStatus(
  timeEntryId: string,
  status: TimeEntryStatus
): Promise<{ ok: boolean; error?: string }> {
  if (!(TIME_ENTRY_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: {
      matterId: true,
      leadId: true,
      userId: true,
      calendarEventId: true,
      status: true,
      invoiceId: true,
    },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };

  // Status changes are still edits. Author bypass; otherwise gate.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // "billed" belongs to the invoicing pipeline: generateInvoiceFromWip
  // sets it (together with invoiceId), and voiding/deleting the
  // invoice clears it. A manual flip in either direction desyncs the
  // entry from the invoice's stored subtotal/totalAmount.
  if (status === "billed" && entry.status !== "billed") {
    return { ok: false, error: BILLED_BY_INVOICE_ERROR };
  }
  if (entry.status === "billed" && status !== "billed" && entry.invoiceId) {
    // Unbilling while invoiceId stays set would strand the entry:
    // excluded from future WIP runs, yet still counted in its old
    // invoice's totals. Void/delete the invoice — that path already
    // resets its entries back to WIP.
    return {
      ok: false,
      error:
        "Entry is on an invoice. Void or delete the invoice to return it to WIP.",
    };
  }

  // Optimistic write: only flip the status we read. A concurrent
  // invoice run (to billed) or another edit makes this match nothing,
  // and we say so instead of overwriting the newer state.
  const written = await prisma.timeEntry.updateMany({
    where: { id: timeEntryId, status: entry.status },
    data: { status },
  });
  if (written.count === 0) {
    return {
      ok: false,
      error:
        "This entry changed while you were editing it. Reload and try again.",
    };
  }

  revalidateEntryScope(entry);
  await logActivity({
    matterId: entry.matterId,
    userId: actorId,
    type: "time_entry",
    title: `Time entry status changed · ${entry.status} → ${status}`,
  });
  return { ok: true };
}

export async function deleteTimeEntry(
  timeEntryId: string
): Promise<{ ok: boolean; error?: string }> {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: {
      id: true,
      matterId: true,
      leadId: true,
      userId: true,
      calendarEventId: true,
      status: true,
      hours: true,
      activity: true,
      privileged: true,
    },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };
  // Author can always delete their own unbilled entries; otherwise
  // gate on time_entries.delete_any.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.delete_any");
  }
  // Don't let users delete entries that are already on an invoice —
  // accounting hygiene. Unbill first.
  if (entry.status === "billed") {
    return {
      ok: false,
      error: "Entry is already billed. Unbill it before deleting.",
    };
  }

  // Conditional delete, same race as updateTimeEntry: never remove a
  // row that invoice generation just attached to an invoice.
  const removed = await prisma.timeEntry.deleteMany({
    where: { id: timeEntryId, status: { not: "billed" } },
  });
  if (removed.count === 0) {
    return {
      ok: false,
      error:
        "Entry is already billed or no longer exists. Reload to see its current state.",
    };
  }

  revalidateEntryScope(entry);
  await logActivity({
    matterId: entry.matterId,
    userId: actorId,
    type: "time_entry",
    title: `Time entry deleted · ${entry.hours}h`,
    detail: entry.privileged ? undefined : entry.activity,
  });
  return { ok: true };
}
