/**
 * Shared parse / validate / create pipeline for captures that ride
 * along with a note ("Also capture" tasks, deadlines, time entries,
 * events and sibling notes).
 *
 * `createNote` (notes.ts) and `addCapturesToNoteBulk`
 * (note-attachments.ts) used to carry their own copy of this loop and
 * the copies drifted (permissions, creator, time zone). Both now go
 * through here, so a rule change lands once. Not a "use server" file
 * on purpose: it exports plain helpers, not actions.
 *
 * Dates follow ADR-012:
 *   - task / deadline / time-entry dates are date-only values stored
 *     at UTC midnight (`parseDateOnly`), never zone-shifted;
 *   - event start / end are instants typed as wall-clock time in the
 *     VIEWER'S profile zone (`parseWallClock(value, tz)`). `new
 *     Date("2026-08-01T09:00")` would read them in the server's zone
 *     (UTC in production) and store every event hours off.
 */

import type { Tx } from "@/lib/prisma";
import { captureSchema, type ValidCapture } from "@/lib/capture-schemas";
import { parseDateOnly, parseWallClock } from "@/lib/format-date";
import { addDefaultEventAttendees } from "@/lib/calendar-default-attendees";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { currentUserHasPermission } from "@/lib/permission-check";

export type CaptureErrors = Record<string, Record<string, string[]>>;

/** A schema-valid capture plus its date fields resolved to Dates
 *  (only the ones its kind uses are non-null). */
export type PreparedCapture = {
  cap: ValidCapture;
  /** task / deadline due date (date-only, UTC midnight). */
  dueDate: Date | null;
  /** time-entry date (date-only, UTC midnight). */
  date: Date | null;
  /** event start / end (instants). */
  start: Date | null;
  end: Date | null;
};

export type ParsedCaptures =
  | { ok: true; captures: PreparedCapture[] }
  | { ok: false; reason: "malformed" }
  | { ok: false; reason: "invalid"; attachmentErrors: CaptureErrors };

function tempIdOf(raw: unknown): string {
  const id = (raw as { tempId?: unknown } | null)?.tempId;
  return typeof id === "string" ? id : "unknown";
}

function addError(errors: CaptureErrors, tempId: string, field: string, message: string): void {
  errors[tempId] ??= {};
  (errors[tempId][field] ??= []).push(message);
}

/**
 * Decode the `attachments` JSON, schema-validate every capture and
 * resolve its dates. `tz` is the viewer's profile zone (used for
 * event wall-clock times only). Pure; touches no database.
 */
export function parseCaptures(rawJson: string, tz: string): ParsedCaptures {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const rawList: unknown[] = Array.isArray(decoded) ? decoded : [];

  const errors: CaptureErrors = {};
  const captures: PreparedCapture[] = [];
  for (const raw of rawList) {
    const result = captureSchema.safeParse(raw);
    if (!result.success) {
      errors[tempIdOf(raw)] = result.error.flatten().fieldErrors as Record<string, string[]>;
      continue;
    }
    const cap = result.data;
    const prepared: PreparedCapture = {
      cap,
      dueDate: null,
      date: null,
      start: null,
      end: null,
    };
    if (cap.kind === "task" && cap.dueDate) {
      prepared.dueDate = parseDateOnly(cap.dueDate);
      if (!prepared.dueDate) {
        addError(errors, cap.tempId, "dueDate", "Enter a valid date");
      }
    } else if (cap.kind === "deadline") {
      prepared.dueDate = parseDateOnly(cap.dueDate);
      if (!prepared.dueDate) {
        addError(errors, cap.tempId, "dueDate", "Enter a valid date");
      }
    } else if (cap.kind === "time") {
      prepared.date = parseDateOnly(cap.date);
      if (!prepared.date) {
        addError(errors, cap.tempId, "date", "Enter a valid date");
      }
    } else if (cap.kind === "event") {
      prepared.start = parseWallClock(cap.startTime, tz);
      prepared.end = parseWallClock(cap.endTime, tz);
      if (!prepared.start) {
        addError(errors, cap.tempId, "startTime", "Invalid start time");
      }
      if (!prepared.end) {
        addError(errors, cap.tempId, "endTime", "Invalid end time");
      }
      if (prepared.start && prepared.end && prepared.end.getTime() < prepared.start.getTime()) {
        addError(errors, cap.tempId, "endTime", "End must be after start");
      }
    }
    captures.push(prepared);
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: "invalid", attachmentErrors: errors };
  }
  return { ok: true, captures };
}

// ── Permission pre-check ───────────────────────────────────────────────

const PERMISSION_PHRASE: Record<string, string> = {
  "tasks.create": "create tasks",
  "events.create": "create events",
  "deadlines.create": "create deadlines",
  "time_entries.create": "log time",
  "notes.create": "create notes",
  "notes.pin": "pin notes",
};

/**
 * The subset of `keys` the current user does NOT hold, for a friendly
 * form error. The redirecting gate (`requirePermissions`) stays the
 * enforcement point; this runs first so a denied kind returns an error
 * the composer can show instead of bouncing the user to the dashboard
 * and throwing away what they typed.
 */
export async function missingPermissions(keys: Iterable<string>): Promise<string[]> {
  const missing: string[] = [];
  for (const key of keys) {
    if (!(await currentUserHasPermission(key))) missing.push(key);
  }
  return missing;
}

/** "You don't have permission to create tasks and log time." */
export function permissionDeniedMessage(missing: readonly string[]): string {
  const phrases = missing.map((k) => PERMISSION_PHRASE[k] ?? k);
  const list =
    phrases.length <= 1
      ? (phrases[0] ?? "do that")
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `You don't have permission to ${list}. Remove those items and try again.`;
}

// ── Row creation ───────────────────────────────────────────────────────

/** Per-request context for `createCaptureRecord`. `createdEventIds`
 *  collects events so the caller can push them to Google AFTER the
 *  transaction commits. */
export type CaptureCreateCtx = {
  matterId: string;
  userId: string;
  /** Note that spawned the capture; set on tasks / deadlines / time
   *  entries so they show in that note's attached list. */
  noteId: string;
  /** Resolved `autoAddTeamToNewEvents` (see resolveAutoAddTeam). */
  autoAddTeam: boolean;
  createdEventIds: string[];
};

/** Create the row for one prepared capture inside the caller's
 *  transaction. `note_sibling` creates an independent matter note
 *  (no parent); surfaces that don't take siblings filter them out
 *  before calling. */
export async function createCaptureRecord(
  tx: Tx,
  p: PreparedCapture,
  ctx: CaptureCreateCtx,
): Promise<void> {
  const { cap } = p;
  const { matterId, userId, noteId } = ctx;
  switch (cap.kind) {
    case "task":
      await tx.task.create({
        data: {
          matterId,
          // Links the capture to the note that spawned it so the
          // note's attached list surfaces it.
          noteId,
          title: cap.title,
          priority: cap.priority,
          dueDate: p.dueDate,
          ownerId: userId,
        },
      });
      return;
    case "deadline":
      await tx.deadline.create({
        data: {
          matterId,
          noteId,
          title: cap.title,
          dueDate: p.dueDate!,
          kind: cap.kind_,
          description: cap.description || null,
          ownerId: userId,
        },
      });
      return;
    case "time":
      await tx.timeEntry.create({
        data: {
          matterId,
          userId,
          noteId,
          date: p.date!,
          hours: Number(cap.hours),
          activity: cap.activity,
          narrative: cap.narrative || null,
          source: "manual",
        },
      });
      return;
    case "event": {
      // Events don't carry noteId (Note.calendarEventId is the only
      // note <-> event link, and a capture doesn't set it); the
      // events tab is their surface. Same shape as the Events
      // composer: a creator (so they can see/edit it and Google sync
      // has an owner) plus the default attendees.
      const ev = await tx.calendarEvent.create({
        data: {
          matterId,
          createdById: userId,
          title: cap.title,
          type: cap.type,
          startTime: p.start!,
          endTime: p.end!,
          location: cap.location || null,
        },
        select: { id: true },
      });
      await addDefaultEventAttendees(tx, {
        eventId: ev.id,
        matterId,
        userId,
        autoAddTeam: ctx.autoAddTeam,
      });
      ctx.createdEventIds.push(ev.id);
      return;
    }
    case "note_sibling": {
      const sibling = await tx.note.create({
        data: {
          matterId,
          authorId: userId,
          content: sanitizeUserHtml(cap.content),
          type: cap.type,
          isPinned: cap.isPinned,
        },
        select: { id: true },
      });
      // The author starts "read" on their own note.
      await tx.noteRead.create({ data: { userId, noteId: sibling.id } });
      return;
    }
  }
}
