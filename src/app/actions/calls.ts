/**
 * Manual call logging.
 *
 * "Log a call" v1 from docs/features/communication-calls.md — phone work happens off-app
 * today (personal cell, desk phone), so this records the fact of a
 * call after it happened: who, direction, outcome, duration, summary,
 * optional matter filing.
 *
 * Storage rides the messenger data model rather than a parallel
 * table: the call becomes a `MessengerItem` (kind="call") inside the
 * `MessengerThread` for that contact's number, so manually logged
 * calls render inline in the /communication Messages view today and
 * interleave with real Quo-synced traffic when that integration
 * lands. Manual items are identifiable by their `providerEventId`
 * `manual-<uuid>` prefix.
 *
 * Threads need an owning `MessengerAccount`. We prefer the firm's
 * first active REAL provider line (so manual logs join the same
 * thread as synced traffic for that number); the provider="manual"
 * placeholder is only the fallback while no real line is connected,
 * and is bootstrapped on first use holding the firm's phone number.
 *
 * Filing: a call's matter lives on the ITEM (`MessengerItem.matterId`)
 * only. A thread's `defaultMatterId` is never set from a manual log -
 * the first call filed to a matter must not silently route every later
 * "No matter (general)" call (and the time logged on it) to that
 * matter.
 *
 * Instants: the composer's zone-less datetime-local value is parsed as
 * wall-clock time in the user's PROFILE zone (ADR-012), never the
 * server's.
 *
 * Edit / delete: ONLY manual items are mutable. Provider-synced
 * items (anything without the `manual-` prefix) are the firm's
 * immutable record of what actually happened on the line — both
 * mutations refuse them outright. Thread denormalizations
 * (`lastItemAt`) are recomputed from the surviving items so the
 * inbox sort never points at a moved or deleted item.
 *
 * Auth: `communication.log_call` / `.edit_call` / `.delete_call`.
 */

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertOptionalMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { normalizePhone } from "@/lib/queries/messenger";
import { formatDate } from "@/lib/format-date";
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  formatCallDuration,
  isManualCallLog,
  parseCallOccurredAt,
  type CallLogFormState,
} from "@/lib/call-log-form";
import { isRecordNotFound, isUniqueViolation } from "@/lib/prisma-errors";

const logCallSchema = z.object({
  contactId: z.string().min(1, "Pick a contact"),
  /** Optional override / fill-in when the contact has no phone on
   *  file. Free-form — normalized before storage. */
  phone: z.string().max(40).optional().or(z.literal("")),
  direction: z.enum(CALL_DIRECTIONS),
  outcome: z.enum(CALL_OUTCOMES),
  /** `datetime-local` value, e.g. "2026-06-10T14:30". */
  occurredAt: z.string().min(1, "When did the call happen?"),
  /** Whole minutes. Blank for missed / unknown-duration calls. */
  durationMin: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || (/^\d+$/.test(v.trim()) && Number(v.trim()) <= 24 * 60),
      "Duration must be whole minutes (max 1440)"
    ),
  matterId: z.string().optional().or(z.literal("")),
  summary: z.string().max(4000, "Keep the summary under 4000 characters").optional().or(z.literal("")),
});

export async function logCall(
  _prev: CallLogFormState,
  formData: FormData
): Promise<CallLogFormState> {
  await requirePermission("communication.log_call");
  const userId = await getCurrentUserId();

  const parsed = logCallSchema.safeParse({
    contactId: formData.get("contactId") ?? "",
    phone: formData.get("phone") ?? "",
    direction: formData.get("direction") ?? "",
    outcome: formData.get("outcome") ?? "",
    occurredAt: formData.get("occurredAt") ?? "",
    durationMin: formData.get("durationMin") ?? "",
    matterId: formData.get("matterId") ?? "",
    summary: formData.get("summary") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const input = parsed.data;

  const tz = await getCurrentUserTimeZone();
  const occurredAt = parseCallOccurredAt(input.occurredAt, tz);
  if (!occurredAt) {
    return { status: "error", errors: { occurredAt: ["Invalid date / time"] } };
  }

  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: {
      id: true,
      name: true,
      phone: true,
      phones: {
        where: { isPrimary: true },
        select: { number: true },
        take: 1,
      },
    },
  });
  if (!contact) {
    return { status: "error", errors: { contactId: ["Contact not found"] } };
  }

  // A typed number wins - but only if it is a real one. A junk entry
  // ("n/a", a 7-digit local number) must not silently fall through to
  // the number on file, nor mint a thread no later lookup matches.
  const typedPhone = input.phone?.trim();
  let contactPhone: string | null;
  if (typedPhone) {
    contactPhone = normalizePhone(typedPhone);
    if (!contactPhone) {
      return {
        status: "error",
        errors: {
          phone: [
            "Enter a valid phone number (10 digits, or start with + for international).",
          ],
        },
      };
    }
  } else {
    contactPhone =
      normalizePhone(contact.phone) ??
      normalizePhone(contact.phones[0]?.number);
    if (!contactPhone) {
      const hasUnusable = !!(contact.phone || contact.phones[0]?.number);
      return {
        status: "error",
        errors: {
          phone: [
            hasUnusable
              ? "The phone on file for this contact isn't a valid number — enter the number."
              : "This contact has no phone on file — enter the number.",
          ],
        },
      };
    }
  }

  const matterId = input.matterId || null;
  await assertOptionalMatterAccess(matterId);
  if (matterId) {
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    });
    if (!matter) {
      return { status: "error", errors: { matterId: ["Matter not found"] } };
    }
  }

  // Outcome shapes the duration: a call nobody answered has none.
  const answered = input.outcome === "answered";
  const durationSec =
    answered && input.durationMin
      ? Number(input.durationMin.trim()) * 60
      : answered
        ? null
        : 0;

  const account = await getOrCreateLoggingAccount();

  const write = () =>
    prisma.$transaction(async (tx) => {
      const thread = await tx.messengerThread.findUnique({
        where: {
          accountId_contactPhone: { accountId: account.id, contactPhone },
        },
        select: {
          id: true,
          contactId: true,
          lastItemAt: true,
          contact: { select: { name: true } },
        },
      });
      // The number's thread already belongs to someone else (a shared
      // switchboard / main line). Filing this call into it would show
      // the wrong person everywhere the thread's contact is read, so
      // refuse rather than silently ignore the contact the user picked.
      if (thread?.contactId && thread.contactId !== contact.id) {
        return { conflictName: thread.contact?.name ?? "another contact" };
      }

      let threadId: string;
      if (!thread) {
        // No defaultMatterId: the filing lives on the item (see header).
        const created = await tx.messengerThread.create({
          data: {
            accountId: account.id,
            contactPhone,
            contactId: contact.id,
            lastItemAt: occurredAt,
          },
          select: { id: true },
        });
        threadId = created.id;
      } else {
        threadId = thread.id;
        await tx.messengerThread.update({
          where: { id: thread.id },
          data: {
            // Backfill contact resolution on threads created from raw
            // webhook traffic (contactId is null here, or already ours).
            contactId: contact.id,
            ...(occurredAt > thread.lastItemAt
              ? { lastItemAt: occurredAt }
              : {}),
          },
        });
      }

      await tx.messengerItem.create({
        data: {
          threadId,
          providerEventId: `manual-${randomUUID()}`,
          kind: "call",
          direction: input.direction,
          fromNumber:
            input.direction === "inbound" ? contactPhone : account.phoneNumber,
          toNumber:
            input.direction === "inbound" ? account.phoneNumber : contactPhone,
          body: input.summary?.trim() || null,
          callDurationSec: durationSec,
          callStatus: input.outcome,
          matterId,
          // You logged it yourself - never surfaces as unread.
          isRead: true,
          occurredAt,
        },
        select: { id: true },
      });
      return { conflictName: null };
    });

  let outcome: { conflictName: string | null };
  try {
    outcome = await write();
  } catch (err) {
    // Two first-logs to the same new number raced on
    // @@unique([accountId, contactPhone]); the loser's transaction
    // rolled back, so one retry sees the winner's thread.
    if (!isUniqueViolation(err)) throw err;
    outcome = await write();
  }
  if (outcome.conflictName) {
    return {
      status: "error",
      errors: {
        phone: [
          `This number is already linked to ${outcome.conflictName}. Log the call with that contact, or use a different number.`,
        ],
      },
    };
  }

  const duration = formatCallDuration(durationSec);
  await logActivity({
    matterId,
    userId,
    type: "call",
    title: `Logged a call with ${contact.name}`,
    detail: [
      input.direction === "inbound" ? "Inbound" : "Outbound",
      answered ? null : "missed",
      duration,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  revalidatePath("/communication");
  if (matterId) {
    revalidatePath(`/matters/${matterId}`);
    revalidatePath(`/matters/${matterId}/timeline`);
    revalidatePath(`/matters/${matterId}/communication`);
  }

  return { status: "ok" };
}

// ── Edit ────────────────────────────────────────────────────────────────

/** Same fields as `logCall` minus contact/phone — the contact is the
 *  thread's identity (moving a call between people means re-logging
 *  it), so edit covers outcome / direction / when / duration /
 *  summary / matter filing only. */
const updateCallSchema = logCallSchema
  .omit({ contactId: true, phone: true })
  .extend({ itemId: z.string().min(1) });

export async function updateCallLog(
  _prev: CallLogFormState,
  formData: FormData
): Promise<CallLogFormState> {
  await requirePermission("communication.edit_call");
  const userId = await getCurrentUserId();

  const parsed = updateCallSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    direction: formData.get("direction") ?? "",
    outcome: formData.get("outcome") ?? "",
    occurredAt: formData.get("occurredAt") ?? "",
    durationMin: formData.get("durationMin") ?? "",
    matterId: formData.get("matterId") ?? "",
    summary: formData.get("summary") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const input = parsed.data;

  const tz = await getCurrentUserTimeZone();
  const occurredAt = parseCallOccurredAt(input.occurredAt, tz);
  if (!occurredAt) {
    return { status: "error", errors: { occurredAt: ["Invalid date / time"] } };
  }

  const item = await prisma.messengerItem.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      providerEventId: true,
      kind: true,
      threadId: true,
      direction: true,
      fromNumber: true,
      toNumber: true,
      matterId: true,
      occurredAt: true,
      matter: { select: { name: true } },
      thread: {
        select: {
          defaultMatterId: true,
          contactPhone: true,
          contact: { select: { name: true } },
        },
      },
    },
  });
  if (!item) {
    return { status: "error", errors: { form: ["Call log not found"] } };
  }
  await assertOptionalMatterAccess(item.matterId ?? item.thread.defaultMatterId);
  // Provider-synced items are immutable records of what actually
  // happened on the line — only manual logs may be corrected.
  if (item.kind !== "call" || !isManualCallLog(item.providerEventId)) {
    return {
      status: "error",
      errors: { form: ["Only manually logged calls can be edited."] },
    };
  }

  const matterId = input.matterId || null;
  await assertOptionalMatterAccess(matterId);
  let newMatterName: string | null = null;
  if (matterId) {
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true, name: true },
    });
    if (!matter) {
      return { status: "error", errors: { matterId: ["Matter not found"] } };
    }
    newMatterName = matter.name;
  }

  // Same duration derivation as logCall — unanswered calls have none.
  const answered = input.outcome === "answered";
  const durationSec =
    answered && input.durationMin
      ? Number(input.durationMin.trim()) * 60
      : answered
        ? null
        : 0;

  // Direction flip swaps the endpoints; the numbers themselves are
  // fixed by the thread (contact side) + account (firm side).
  const flipped = input.direction !== item.direction;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.messengerItem.update({
        where: { id: item.id },
        data: {
          direction: input.direction,
          fromNumber: flipped ? item.toNumber : item.fromNumber,
          toNumber: flipped ? item.fromNumber : item.toNumber,
          body: input.summary?.trim() || null,
          callDurationSec: durationSec,
          callStatus: input.outcome,
          matterId,
          occurredAt,
        },
      });
      // occurredAt may have moved either way — recompute lastItemAt
      // from all items so the inbox sort key never regresses or points
      // at a time no item carries.
      const agg = await tx.messengerItem.aggregate({
        where: { threadId: item.threadId },
        _max: { occurredAt: true },
      });
      await tx.messengerThread.update({
        where: { id: item.threadId },
        data: { lastItemAt: agg._max.occurredAt ?? occurredAt },
      });
    });
  } catch (err) {
    // Another user deleted the call between our read and the write.
    if (isRecordNotFound(err)) {
      return { status: "error", errors: { form: ["Call log not found"] } };
    }
    throw err;
  }

  const contactLabel = item.thread.contact?.name ?? item.thread.contactPhone;
  const duration = formatCallDuration(durationSec);
  // The matter a call is LISTED on: its own filing, else the thread's
  // default routing (legacy / provider threads).
  const oldEffectiveMatterId = item.matterId ?? item.thread.defaultMatterId;
  const newEffectiveMatterId = matterId ?? item.thread.defaultMatterId;
  const timeChanged = item.occurredAt.getTime() !== occurredAt.getTime();
  await logActivity({
    matterId: newEffectiveMatterId,
    userId,
    type: "call",
    title: `Updated a logged call with ${contactLabel}`,
    detail: [
      input.direction === "inbound" ? "Inbound" : "Outbound",
      answered ? null : "missed",
      duration,
      timeChanged
        ? `time ${formatDate(item.occurredAt, "datetime", tz)} → ${formatDate(occurredAt, "datetime", tz)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  // Moved off a matter (re-filed or un-filed): leave a trace on the
  // matter it came from, with what it was, so its timeline does not
  // keep showing a call that is no longer there.
  if (oldEffectiveMatterId && oldEffectiveMatterId !== newEffectiveMatterId) {
    await logActivity({
      matterId: oldEffectiveMatterId,
      userId,
      type: "call",
      title: `Moved a logged call with ${contactLabel} off this matter`,
      detail: [
        item.matter?.name ? `was filed to ${item.matter.name}` : null,
        `now ${newMatterName ? `filed to ${newMatterName}` : "unfiled"}`,
        `call at ${formatDate(item.occurredAt, "datetime", tz)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  revalidateCallSurfaces([
    item.matterId,
    matterId,
    item.thread.defaultMatterId,
  ]);
  return { status: "ok" };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteCallLog(
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("communication.delete_call");
  const userId = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();

  const item = await prisma.messengerItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      providerEventId: true,
      kind: true,
      threadId: true,
      direction: true,
      matterId: true,
      occurredAt: true,
      thread: {
        select: {
          defaultMatterId: true,
          followUpAt: true,
          isPinned: true,
          contactPhone: true,
          contact: { select: { name: true } },
        },
      },
    },
  });
  if (!item) return { ok: false, error: "Call log not found" };
  await assertOptionalMatterAccess(item.matterId ?? item.thread.defaultMatterId);
  // Provider-synced items are immutable records of what actually
  // happened on the line — only manual logs may be removed.
  if (item.kind !== "call" || !isManualCallLog(item.providerEventId)) {
    return {
      ok: false,
      error:
        "Only manually logged calls can be deleted — provider-synced items are permanent records.",
    };
  }

  // A thread that carries user-set state (follow-up reminder, pin)
  // outlives its last call; a stateless one is an empty shell that
  // both logCall and the provider webhook re-create on demand.
  // defaultMatterId is deliberately NOT state here: legacy manual
  // calls auto-assigned it to every thread they created, so keeping
  // such threads would leave a blank, preview-less conversation in
  // the messenger inbox after the only call is deleted.
  const threadHasState =
    item.thread.followUpAt !== null || item.thread.isPinned;

  try {
    await prisma.$transaction(async (tx) => {
      // Time entries / tasks / notes spawned from this item survive the
      // delete (their FKs SetNull) - billed time stays billed, it just
      // loses its "logged on this call" link.
      await tx.messengerItem.delete({ where: { id: item.id } });

      const remaining = await tx.messengerItem.aggregate({
        where: { threadId: item.threadId },
        _count: true,
        _max: { occurredAt: true },
      });
      if (remaining._count === 0) {
        if (!threadHasState) {
          await tx.messengerThread.delete({ where: { id: item.threadId } });
        }
        // else: keep the (now empty) thread so its follow-up / pin /
        // default routing is not silently lost.
      } else {
        // lastItemAt must never point at the deleted item. unreadCount
        // needs no adjustment: manual logs are always isRead.
        await tx.messengerThread.update({
          where: { id: item.threadId },
          data: { lastItemAt: remaining._max.occurredAt! },
        });
      }
    });
  } catch (err) {
    // Deleted concurrently by someone else - the goal state is reached.
    if (isRecordNotFound(err)) {
      return { ok: false, error: "Call log not found" };
    }
    throw err;
  }

  const contactLabel = item.thread.contact?.name ?? item.thread.contactPhone;
  await logActivity({
    // Log on the matter the call was listed under, including
    // inherited thread-default routing.
    matterId: item.matterId ?? item.thread.defaultMatterId,
    userId,
    type: "call",
    title: `Deleted a logged call with ${contactLabel}`,
    detail: [
      item.direction === "inbound" ? "Inbound" : "Outbound",
      `call at ${formatDate(item.occurredAt, "datetime", tz)}`,
    ].join(" · "),
  });

  revalidateCallSurfaces([item.matterId, item.thread.defaultMatterId]);
  return { ok: true };
}

/** Refresh /communication plus every matter whose Phone channel /
 *  timeline could list the touched item — its own filing (old and
 *  new on edit) and the thread's default routing target, since the
 *  matter phone log resolves items through either. */
function revalidateCallSurfaces(matterIds: Array<string | null>) {
  revalidatePath("/communication");
  for (const id of new Set(matterIds.filter((m): m is string => !!m))) {
    revalidatePath(`/matters/${id}`);
    revalidatePath(`/matters/${id}/timeline`);
    revalidatePath(`/matters/${id}/communication`);
  }
}

/** The MessengerAccount manual logs hang off. Prefers the firm's first
 *  active REAL provider line so manual + synced traffic share threads
 *  (the "manual" placeholder is itself active and always the oldest
 *  row, so it must not win once a real line exists); falls back to the
 *  provider="manual" placeholder, bootstrapping it when none exists. */
async function getOrCreateLoggingAccount(): Promise<{
  id: string;
  phoneNumber: string;
}> {
  const select = { id: true, phoneNumber: true } as const;
  const real = await prisma.messengerAccount.findFirst({
    where: { isActive: true, provider: { not: "manual" } },
    orderBy: { createdAt: "asc" },
    select,
  });
  if (real) return real;
  const manual = await prisma.messengerAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select,
  });
  if (manual) return manual;

  const firm = await prisma.firm.findFirst({ select: { phone: true } });
  const phoneNumber = normalizePhone(firm?.phone) ?? "unknown";
  try {
    return await prisma.messengerAccount.create({
      data: { provider: "manual", phoneNumber, label: "Manually logged" },
      select,
    });
  } catch (err) {
    // Concurrent first log created it (@@unique([provider, phoneNumber])).
    if (!isUniqueViolation(err)) throw err;
    return prisma.messengerAccount.findFirstOrThrow({
      where: { provider: "manual", phoneNumber },
      select,
    });
  }
}
