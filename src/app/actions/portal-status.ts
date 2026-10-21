/**
 * Staff actions for the client portal "case status" feature.
 *
 * Every action gates on its permission, then asserts matter access
 * (ADR-039) outside any try/catch so a walled user gets Next's
 * not-found.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermissionResult } from "@/lib/permission-check";
import { logActivity, logActivityTx } from "@/lib/activity-log";
import { statusUpdateEmail } from "@/lib/portal/emails";
import { getCalendarEventById } from "@/lib/queries/calendar";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { emailLivePortalUsers } from "@/lib/portal/notify-clients";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

const NOT_FOUND = "Update not found.";

function done(matterId: string, warning?: string): Result {
  revalidatePath(`/matters/${matterId}`);
  return warning ? { ok: true, warning } : { ok: true };
}

// ---------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------

const updateSchema = z.object({
  stageLabel: z
    .string()
    .trim()
    .min(1, "Enter a stage label.")
    .max(60, "That stage label is too long (60 characters max)."),
  body: z
    .string()
    .trim()
    .min(1, "Enter an update.")
    .max(4000, "That update is too long (4,000 characters max)."),
});

function parseUpdate(
  input: unknown
): { ok: true; stageLabel: string; body: string } | { ok: false; error: string } {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid update." };
  }
  return { ok: true, ...parsed.data };
}

export async function postStatusUpdate(
  matterId: string,
  input: { stageLabel: string; body: string; emailClient: boolean }
): Promise<Result> {
  const gate = await requirePermissionResult("portal.add_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  await assertMatterAccess(matterId);

  const parsed = parseUpdate(input);
  if (!parsed.ok) return parsed;

  // The update and its audit row commit together; the email goes out after.
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.portalStatusUpdate.create({
      data: {
        matterId,
        stageLabel: parsed.stageLabel,
        body: parsed.body,
        postedById: gate.userId,
      },
      select: { id: true },
    });
    await logActivityTx(tx, {
      matterId,
      userId: gate.userId,
      type: "note",
      title: `Posted client status update: ${parsed.stageLabel}`,
    });
    return created;
  });

  let emailFailed = false;
  if (input.emailClient) {
    try {
      const res = await emailLivePortalUsers(matterId, statusUpdateEmail(portalHomeUrl()));
      emailFailed = res.failed > 0;
      if (res.sent > 0) {
        // The email already went out; a failed bookkeeping write must not
        // read as "email didn't send".
        try {
          await prisma.portalStatusUpdate.update({
            where: { id: row.id },
            data: { emailedAt: new Date() },
          });
        } catch (err) {
          console.warn("[portal-status] could not record emailedAt", err);
        }
      }
    } catch (err) {
      console.warn("[portal-status] update email failed", err);
      emailFailed = true;
    }
  }

  return done(matterId, emailFailed ? "Update posted, but the email didn't send." : undefined);
}

async function loadUpdate(id: string) {
  return prisma.portalStatusUpdate.findUnique({
    where: { id },
    select: { id: true, matterId: true },
  });
}

/** Edits never re-send the email. */
export async function editStatusUpdate(
  id: string,
  input: { stageLabel: string; body: string }
): Promise<Result> {
  const gate = await requirePermissionResult("portal.edit_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await loadUpdate(id);
  if (!row) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(row.matterId);

  const parsed = parseUpdate(input);
  if (!parsed.ok) return parsed;

  const res = await prisma.portalStatusUpdate.updateMany({
    where: { id, matterId: row.matterId },
    data: { stageLabel: parsed.stageLabel, body: parsed.body, editedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, error: NOT_FOUND };
  await logActivity({
    matterId: row.matterId,
    userId: gate.userId,
    type: "note",
    title: "Edited client status update",
  });
  return done(row.matterId);
}

export async function deleteStatusUpdate(id: string): Promise<Result> {
  const gate = await requirePermissionResult("portal.delete_updates");
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await loadUpdate(id);
  if (!row) return { ok: false, error: NOT_FOUND };
  await assertMatterAccess(row.matterId);

  const res = await prisma.portalStatusUpdate.deleteMany({
    where: { id, matterId: row.matterId },
  });
  if (res.count === 0) return { ok: false, error: NOT_FOUND };
  await logActivity({
    matterId: row.matterId,
    userId: gate.userId,
    type: "note",
    title: "Deleted client status update",
  });
  return done(row.matterId);
}

// ---------------------------------------------------------------------
// Event sharing
// ---------------------------------------------------------------------

const EVENT_NOT_FOUND = "Event not found.";
const NOT_SHARED = "This event isn't shared.";

const shareSchema = z.object({
  clientTitle: z
    .string()
    .trim()
    .min(1, "Enter a title for the client.")
    .max(200, "That title is too long (200 characters max)."),
  clientNote: z
    .string()
    .trim()
    .max(2000, "That note is too long (2,000 characters max).")
    .optional()
    .transform((v) => (v ? v : null)),
});

function doneEvent(matterId: string): Result {
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/events`);
  revalidatePath("/calendar");
  return { ok: true };
}

/** Permission and event load. Lead events read as unknown (no existence leak). Callers then assert matter access, then `requireVisibleEvent`. */
async function gateEvent(permission: string, eventId: string) {
  const gate = await requirePermissionResult(permission);
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { id: true, matterId: true },
  });
  if (!event || !event.matterId) return { ok: false as const, error: EVENT_NOT_FOUND };
  return { ok: true as const, userId: gate.userId, eventId: event.id, matterId: event.matterId };
}

/**
 * Sharing publishes an event's time and location to the client, so the
 * sharer must be able to see its details (private / "Busy" events are
 * refused). Reuses the calendar visibility resolver.
 */
async function requireVisibleEvent(eventId: string) {
  const detail = await getCalendarEventById(eventId);
  if (!detail || !detail.viewerCanSeeDetails || !detail.matter) {
    return { ok: false as const, error: EVENT_NOT_FOUND };
  }
  return { ok: true as const };
}

export async function shareEventWithClient(
  eventId: string,
  input: { clientTitle: string; clientNote?: string }
): Promise<Result> {
  const g = await gateEvent("portal.share_events", eventId);
  if (!g.ok) return g;
  await assertMatterAccess(g.matterId);
  const visible = await requireVisibleEvent(g.eventId);
  if (!visible.ok) return visible;
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event share." };
  }
  const { clientTitle, clientNote } = parsed.data;

  const previous = await prisma.portalSharedEvent.findUnique({
    where: { eventId },
    select: { matterId: true },
  });
  await prisma.portalSharedEvent.upsert({
    where: { eventId },
    create: { eventId, matterId: g.matterId, clientTitle, clientNote, sharedById: g.userId },
    update: {
      matterId: g.matterId,
      clientTitle,
      clientNote,
      sharedById: g.userId,
      sharedAt: new Date(),
    },
  });
  await logActivity({
    matterId: g.matterId,
    userId: g.userId,
    type: "note",
    title: `Shared event with client: ${clientTitle}`,
  });
  if (previous && previous.matterId !== g.matterId) doneEvent(previous.matterId);
  return doneEvent(g.matterId);
}

export async function updateEventShare(
  eventId: string,
  input: { clientTitle: string; clientNote?: string }
): Promise<Result> {
  const g = await gateEvent("portal.share_events", eventId);
  if (!g.ok) return g;
  await assertMatterAccess(g.matterId);
  const visible = await requireVisibleEvent(g.eventId);
  if (!visible.ok) return visible;
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event share." };
  }
  const { clientTitle, clientNote } = parsed.data;

  const res = await prisma.portalSharedEvent.updateMany({
    where: { eventId, matterId: g.matterId },
    data: { clientTitle, clientNote },
  });
  if (res.count === 0) return { ok: false, error: NOT_SHARED };
  await logActivity({
    matterId: g.matterId,
    userId: g.userId,
    type: "note",
    title: "Edited client event share",
  });
  return doneEvent(g.matterId);
}

/**
 * Any key holder with matter access can stop a share, even for an event
 * whose details they can't see (it may have gone private after sharing).
 * Stopping only withdraws information, so no visibility check.
 */
export async function stopSharingEvent(eventId: string): Promise<Result> {
  const g = await gateEvent("portal.share_events", eventId);
  if (!g.ok) return g;
  await assertMatterAccess(g.matterId);

  const res = await prisma.portalSharedEvent.deleteMany({
    where: { eventId, matterId: g.matterId },
  });
  if (res.count === 0) return { ok: false, error: NOT_SHARED };
  await logActivity({
    matterId: g.matterId,
    userId: g.userId,
    type: "note",
    title: "Stopped sharing event with client",
  });
  return doneEvent(g.matterId);
}
