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
 * One session per user (userId is @unique) — starting a new timer
 * replaces any existing one via upsert. Elapsed time is never
 * stored; it's computed from `startedAt` at read time (widget ticks
 * client-side, stop composer prefills the rounded value). Stop
 * creates the TimeEntry (source: "timer") and deletes the session
 * row in one transaction.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only input ("YYYY-MM-DD") must parse to LOCAL midnight —
// `new Date(value)` reads it as UTC midnight, which drifts the entry
// a day early for anyone west of UTC. See parseLocalDate docs.
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import {
  isKnownUtbmsCode,
  type TimeEntryFormState,
} from "@/lib/time-entry-constants";

type TimerResult = { ok: boolean; error?: string };

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
async function matterMissingError(
  matterId: string | null | undefined
): Promise<string | null> {
  if (!matterId) return null;
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  return matter ? null : "Matter not found";
}

// ── Start ───────────────────────────────────────────────────────────────

/**
 * Start (or restart) the current user's timer. Matter + activity are
 * optional — a timer can start before the user knows what the work
 * belongs to; the stop composer requires a matter before the
 * TimeEntry is written. Replaces any existing session (userId is
 * unique): the old clock is discarded, not merged — same behavior
 * as every commercial timer widget, and the widget's stop/discard
 * affordances make losing a running clock an explicit choice.
 */
export async function startTimer(input?: {
  matterId?: string | null;
  activity?: string | null;
}): Promise<TimerResult> {
  const userId = await getCurrentUserId();
  const parsed = timerFieldsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid timer input" };

  const matterError = await matterMissingError(parsed.data.matterId);
  if (matterError) return { ok: false, error: matterError };

  const data = {
    matterId: parsed.data.matterId || null,
    activity: parsed.data.activity || null,
    startedAt: new Date(),
  };
  await prisma.timerSession.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

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

  const matterError = await matterMissingError(parsed.data.matterId);
  if (matterError) return { ok: false, error: matterError };

  await prisma.timerSession.update({
    where: { userId },
    data: {
      ...(input.matterId !== undefined
        ? { matterId: parsed.data.matterId || null }
        : {}),
      ...(input.activity !== undefined
        ? { activity: parsed.data.activity || null }
        : {}),
    },
  });

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
  // The stop composer REQUIRES a matter — the TimerSession's matter
  // is nullable, but a TimeEntry's is not.
  matterId: z.string().trim().min(1, "Matter is required"),
  date: z.string().min(1, "Date is required"),
  // Hours arrive prefilled from the widget (elapsed rounded UP to
  // the billing increment) but stay user-editable — same bounds as
  // every other create path.
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  utbmsCode: z
    .string()
    .trim()
    .refine((v) => v === "" || isKnownUtbmsCode(v), "Unknown UTBMS code")
    .optional(),
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
});

/**
 * The one timer path that creates a billing record — gated on
 * `time_entries.create` like the sibling create actions. Writes the
 * TimeEntry (source: "timer") and deletes the session in a single
 * transaction so a crash can't both log the time AND leave the
 * clock running (double billing on a retry).
 */
export async function stopTimer(
  _prev: TimeEntryFormState,
  formData: FormData
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

  // The session must still exist — if it was discarded or stopped in
  // another tab, silently creating a second entry from a stale
  // dialog is exactly the double-log this guard prevents.
  const session = await prisma.timerSession.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!session) {
    return {
      status: "error",
      errors: {
        activity: [
          "No running timer — it may have been stopped or discarded in another tab.",
        ],
      },
      values: raw,
    };
  }

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

  const date = parseLocalDate(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  await prisma.$transaction([
    prisma.timeEntry.create({
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
    }),
    prisma.timerSession.delete({ where: { id: session.id } }),
  ]);

  revalidatePath(`/matters/${parsed.data.matterId}/time`);
  revalidatePath(`/matters/${parsed.data.matterId}`);
  revalidateTimerWidget();
  await logActivity({
    matterId: parsed.data.matterId,
    userId,
    type: "time_entry",
    title: `Time logged from timer · ${parsed.data.hours}h`,
    detail: parsed.data.activity,
  });
  return { status: "ok" };
}
