/**
 * Manual call logging.
 *
 * "Log a call" v1 from FEATURES.md P1 — phone work happens off-app
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
 * Threads need an owning `MessengerAccount`. We reuse the firm's
 * first active account when one exists (so manual logs join the same
 * thread as synced traffic for that number); otherwise we create a
 * single provider="manual" placeholder account holding the firm's
 * phone number.
 *
 * Auth: gated on `communication.log_call`.
 */

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { normalizePhone } from "@/lib/queries/messenger";
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  formatCallDuration,
  type CallLogFormState,
} from "@/lib/call-log-form";

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

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
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

  const contactPhone = normalizePhone(
    input.phone || contact.phone || contact.phones[0]?.number
  );
  if (!contactPhone) {
    return {
      status: "error",
      errors: {
        phone: ["This contact has no phone on file — enter the number."],
      },
    };
  }

  const matterId = input.matterId || null;
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

  const item = await prisma.$transaction(async (tx) => {
    let thread = await tx.messengerThread.findUnique({
      where: {
        accountId_contactPhone: { accountId: account.id, contactPhone },
      },
      select: { id: true, contactId: true, lastItemAt: true },
    });
    if (!thread) {
      thread = await tx.messengerThread.create({
        data: {
          accountId: account.id,
          contactPhone,
          contactId: contact.id,
          defaultMatterId: matterId,
          lastItemAt: occurredAt,
        },
        select: { id: true, contactId: true, lastItemAt: true },
      });
    } else {
      await tx.messengerThread.update({
        where: { id: thread.id },
        data: {
          // Backfill contact resolution on threads created from raw
          // webhook traffic; never clobber an existing resolution.
          ...(thread.contactId ? {} : { contactId: contact.id }),
          ...(occurredAt > thread.lastItemAt
            ? { lastItemAt: occurredAt }
            : {}),
        },
      });
    }

    return tx.messengerItem.create({
      data: {
        threadId: thread.id,
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
        // You logged it yourself — never surfaces as unread.
        isRead: true,
        occurredAt,
      },
      select: { id: true, threadId: true },
    });
  });

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

/** The MessengerAccount manual logs hang off. Reuses the firm's
 *  first active line so manual + synced traffic share threads;
 *  bootstraps a provider="manual" placeholder when no line exists. */
async function getOrCreateLoggingAccount(): Promise<{
  id: string;
  phoneNumber: string;
}> {
  const existing = await prisma.messengerAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, phoneNumber: true },
  });
  if (existing) return existing;

  const firm = await prisma.firm.findFirst({ select: { phone: true } });
  return prisma.messengerAccount.create({
    data: {
      provider: "manual",
      phoneNumber: normalizePhone(firm?.phone) ?? "unknown",
      label: "Manually logged",
    },
    select: { id: true, phoneNumber: true },
  });
}
