/**
 * Timer server actions — the running-clock side of time capture.
 *
 * A TimerSession is a PRE-entry, not a billing record: it's private
 * per-user scratch state ("I started working at 2:14, roughly on
 * matter X") that writes nothing a client is ever billed for. That's
 * why start/update/discard carry NO permission key — gating them
 * would only stop a user from watching their own clock, while the
 * artifact that actually matters (the TimeEntry) is created solely
 * by `stopTimer`, which gates on `time_entries.create` exactly like
 * every other entry-creating path (time-entries.ts, captures.ts,
 * time-on-entity.ts). Denying that one key still closes ALL
 * time-logging entry points, timer included.
 *
 * One session per user (userId is @unique). Starting a timer while
 * one is already running is REFUSED (`code: "already_running"`) unless
 * the caller passes `replace: true` — a stale tab or second device
 * must never silently reset a clock that is still running. An
 * explicit replace deletes the old row and creates a new one (new
 * id), so a stop dialog still holding the old id can't consume the
 * new clock. Elapsed time is never
 * stored; it's computed from `startedAt` at read time (widget ticks
 * client-side, stop composer prefills the rounded value). Stop
 * creates the TimeEntry (source: "timer") and deletes the session
 * row in one transaction.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess, assertOptionalMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only input ("YYYY-MM-DD") is stored as UTC midnight and read
// in UTC on every surface (ADR-012) — never apply a time zone to it.
import { parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import type { TimeEntryFormState } from "@/lib/time-entry-constants";
import { timeEntryFields } from "@/lib/time-entry-schema";
import { isUniqueViolation } from "@/lib/prisma-errors";

type TimerResult = {
  ok: boolean;
  error?: string;
  /** Machine-readable refusal reason the widget acts on. */
  code?: "already_running";
};

const timerFieldsSchema = z.object({
  matterId: z.string().trim().max(64).nullish(),
  activity: z.string().trim().max(200).nullish(),
});

/** The widget lives in the layout — revalidating the layout tree is
 *  what makes the running/idle state flip on every page at once. */
const revalidateTimerWidget = () => revalidatePath("/", "layout");

/** Guard that a caller-supplied matter id points at a real matter.
 *  Returns the error string (or null) so each action can wrap it in
 *  its own result shape. */
async function matterMissingError(matterId: string | null | undefined): Promise<string | null> {
  if (!matterId) return null;
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  return matter ? null : "Matter not found";
}

// ── Start ───────────────────────────────────────────────────────────────

/**
 * Start the current user's timer. Matter + activity are optional — a
 * timer can start before the user knows what the work belongs to;
 * the stop composer requires a matter before the TimeEntry is
 * written.
 *
 * If a session already exists the call is refused with
 * `{ ok: false, code: "already_running" }` and nothing is written:
 * the widget's idle pill is rendered from a server snapshot that can
 * be stale in another tab/device, and silently resetting a running
 * clock loses billable time. Pass `replace: true` for a deliberate
 * restart (the old clock is discarded, not merged).
 */
export async function startTimer(input?: {
  matterId?: string | null;
  activity?: string | null;
  replace?: boolean;
}): Promise<TimerResult> {
  const userId = await getCurrentUserId();
  const parsed = timerFieldsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid timer input" };

  await assertOptionalMatterAccess(parsed.data.matterId);
  const matterError = await matterMissingError(parsed.data.matterId);
  if (matterError) return { ok: false, error: matterError };

  const data = {
    matterId: parsed.data.matterId || null,
    activity: parsed.data.activity || null,
    startedAt: new Date(),
  };
  try {
    if (input?.replace === true) {
      // Delete + create (new id) in one transaction. A concurrent
      // start that wins the unique index between the two statements
      // surfaces as P2002 — treat it as the conflict it is.
      await prisma.$transaction([
        prisma.timerSession.deleteMany({ where: { userId } }),
        prisma.timerSession.create({ data: { userId, ...data } }),
      ]);
    } else {
      await prisma.timerSession.create({ data: { userId, ...data } });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "already_running",
        error: "A timer is already running.",
      };
    }
    throw err;
  }

  revalidateTimerWidget();
  return { ok: true };
}

// ── Update (mid-run) ────────────────────────────────────────────────────

/**
 * Re-point a running timer at a different matter / activity without
 * touching the clock (startedAt is preserved). Only the keys present
 * in `input` are written, so setting just the activity doesn't wipe
 * the matter. Explicit `null` clears a field.
 */
export async function updateTimer(input: {
  matterId?: string | null;
  activity?: string | null;
}): Promise<TimerResult> {
  const userId = await getCurrentUserId();
  const parsed = timerFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid timer input" };

  const session = await prisma.timerSession.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!session) return { ok: false, error: "No running timer" };

  await assertOptionalMatterAccess(parsed.data.matterId);
  const matterError = await matterMissingError(parsed.data.matterId);
  if (matterError) return { ok: false, error: matterError };

  // updateMany, not update: a stop/discard in another tab can delete
  // the row between the read above and this write, and `update` would
  // throw P2025 to the error boundary instead of a friendly refusal.
  const updated = await prisma.timerSession.updateMany({
    where: { userId },
    data: {
      ...(input.matterId !== undefined ? { matterId: parsed.data.matterId || null } : {}),
      ...(input.activity !== undefined ? { activity: parsed.data.activity || null } : {}),
    },
  });
  if (updated.count === 0) return { ok: false, error: "No running timer" };

  revalidateTimerWidget();
  return { ok: true };
}

// ── Discard ─────────────────────────────────────────────────────────────

/**
 * Throw the running timer away without logging anything. Idempotent
 * (deleteMany) — a discard racing a stop in another tab is a no-op,
 * not an error.
 */
export async function discardTimer(): Promise<TimerResult> {
  const userId = await getCurrentUserId();
  await prisma.timerSession.deleteMany({ where: { userId } });
  revalidateTimerWidget();
  return { ok: true };
}

// ── Stop → TimeEntry ────────────────────────────────────────────────────

const stopTimerSchema = z.object({
  // The id of the TimerSession the dialog was opened for. Stopping
  // consumes THAT session only — a stale dialog whose timer was
  // discarded/replaced elsewhere must not log its prefill and
  // delete the newer clock.
  sessionId: z.string().trim().min(1, "Timer session is required").max(64),
  // The stop composer REQUIRES a matter — the TimerSession's matter
  // is nullable, but a TimeEntry's is not.
  matterId: z.string().trim().min(1, "Matter is required"),
  // Hours arrive prefilled from the widget (elapsed rounded UP to
  // the billing increment) but stay user-editable — same bounds as
  // every other create path (shared timeEntryFields).
  ...timeEntryFields,
});

/**
 * The one timer path that creates a billing record — gated on
 * `time_entries.create` like the sibling create actions. Writes the
 * TimeEntry (source: "timer") and deletes the session in a single
 * transaction so a crash can't both log the time AND leave the
 * clock running (double billing on a retry). The delete is keyed on
 * the posted `sessionId` and counts rows, so two racing stops (or a
 * stop racing a discard) resolve to one entry and a friendly error
 * instead of a P2025 crash.
 */
export async function stopTimer(
  _prev: TimeEntryFormState,
  formData: FormData,
): Promise<TimeEntryFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = stopTimerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const userId = await getCurrentUserId();

  // The session the dialog was opened for must still exist — if it
  // was discarded, stopped or replaced in another tab, silently
  // creating a second entry from a stale dialog is exactly the
  // double-log this guard prevents.
  const session = await prisma.timerSession.findFirst({
    where: { id: parsed.data.sessionId, userId },
    select: { id: true },
  });
  if (!session) return staleTimerState(raw);

  await assertMatterAccess(parsed.data.matterId);
  const matter = await prisma.matter.findUnique({
    where: { id: parsed.data.matterId },
    select: { id: true },
  });
  if (!matter) {
    return {
      status: "error",
      errors: { matterId: ["Matter not found"] },
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

  try {
    await prisma.$transaction(async (tx) => {
      // Consume exactly the session the client holds. count === 0
      // means a concurrent stop/discard/replace got there first.
      const consumed = await tx.timerSession.deleteMany({
        where: { id: session.id, userId },
      });
      if (consumed.count === 0) throw new StaleTimerError();
      await tx.timeEntry.create({
        data: {
          matterId: parsed.data.matterId,
          userId,
          date,
          hours: Number(parsed.data.hours),
          activity: parsed.data.activity,
          narrative: parsed.data.narrative || null,
          utbmsCode: parsed.data.utbmsCode || null,
          billable: parsed.data.billable === "on",
          noCharge: parsed.data.noCharge === "on",
          privileged: parsed.data.privileged === "on",
          // "timer" is a documented TimeEntry.source value — marks
          // the entry as captured by the running clock, not typed in.
          source: "timer",
        },
      });
    });
  } catch (err) {
    if (err instanceof StaleTimerError) return staleTimerState(raw);
    throw err;
  }

  revalidatePath(`/matters/${parsed.data.matterId}/time`);
  revalidatePath(`/matters/${parsed.data.matterId}`);
  revalidateTimerWidget();
  await logActivity({
    matterId: parsed.data.matterId,
    userId,
    type: "time_entry",
    title: `Time logged from timer · ${parsed.data.hours}h`,
    // Privileged narratives never reach the firm-wide feed.
    detail: parsed.data.privileged === "on" ? undefined : parsed.data.activity,
  });
  return { status: "ok" };
}

class StaleTimerError extends Error {}

function staleTimerState(raw: Record<string, string>): TimeEntryFormState {
  return {
    status: "error",
    errors: {
      activity: ["No running timer — it may have been stopped or discarded in another tab."],
    },
    values: raw,
  };
}
