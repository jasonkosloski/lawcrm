/**
 * Shared capture schemas.
 *
 * The note composer and the task/event/deadline/time composers all
 * support attaching sibling records alongside their primary. These
 * schemas validate the posted JSON array of captures the same way
 * no matter which primary kicked off the save, so the server actions
 * can share a single parse + transaction loop.
 *
 * Lives outside `src/app/actions/*` because "use server" files can
 * only export async functions; Zod schemas are values.
 */

import { z } from "zod";
import { NOTE_TYPES } from "@/lib/note-constants";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { EVENT_TYPES } from "@/lib/constants/calendar-event-type";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { parseDateOnly, parseWallClock } from "@/lib/format-date";

/** Date-only capture fields travel as "YYYY-MM-DD" (the wire format
 *  of <input type="date">). Validating with `parseDateOnly` here
 *  (shape AND real calendar date) lets the server actions store them
 *  with `parseDateOnly` (UTC midnight, ADR-012) without re-checking. */
const isDateOnly = (v: string): boolean => parseDateOnly(v) !== null;

/** Event start/end travel as zone-less datetime-local values. The
 *  schema only checks them (zone-independent: the order of two
 *  wall-clock values doesn't depend on the zone they're read in);
 *  the action converts them to instants in the USER's zone with
 *  `parseWallClock(value, await getCurrentUserTimeZone())`. */
export function checkEventTimes(
  data: { startTime: string; endTime: string },
  ctx: z.RefinementCtx,
): void {
  const start = parseWallClock(data.startTime, "UTC");
  const end = parseWallClock(data.endTime, "UTC");
  if (!start) {
    ctx.addIssue({
      code: "custom",
      path: ["startTime"],
      message: "Invalid start time",
    });
  }
  if (!end) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Invalid end time",
    });
  }
  if (start && end && end.getTime() < start.getTime()) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "End must be after start",
    });
  }
}

export const taskCaptureSchema = z.object({
  kind: z.literal("task"),
  tempId: z.string(),
  title: z.string().trim().min(1, "Task title is required").max(200),
  dueDate: z
    .string()
    .optional()
    .default("")
    .refine((v) => v === "" || isDateOnly(v), "Enter a valid date"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
});

export const eventCaptureSchema = z
  .object({
    kind: z.literal("event"),
    tempId: z.string(),
    title: z.string().trim().min(1, "Event title is required").max(200),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    type: z.enum(EVENT_TYPES).default("meeting"),
    location: z.string().max(200).optional().default(""),
  })
  .superRefine(checkEventTimes);

export const deadlineCaptureSchema = z.object({
  kind: z.literal("deadline"),
  tempId: z.string(),
  title: z.string().trim().min(1, "Deadline title is required").max(200),
  dueDate: z
    .string()
    .min(1, "Due date is required")
    .refine((v) => isDateOnly(v), "Enter a valid date"),
  kind_: z.enum(DEADLINE_KINDS).default("manual"),
  description: z.string().max(4000).optional().default(""),
});

export const timeCaptureSchema = z.object({
  kind: z.literal("time"),
  tempId: z.string(),
  date: z
    .string()
    .min(1, "Date is required")
    .refine((v) => isDateOnly(v), "Enter a valid date"),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().default(""),
});

/** Sibling note attached to another primary (not the main note flow
 *  on the Notes tab — that's the primary there). The content is
 *  plain text or lightweight HTML; it still runs through sanitizeUserHtml
 *  server-side before insert. */
export const noteSiblingCaptureSchema = z.object({
  kind: z.literal("note_sibling"),
  tempId: z.string(),
  content: z.string().trim().min(1, "Note content is required").max(200_000),
  type: z.enum(NOTE_TYPES).default("note"),
  isPinned: z.boolean().default(false),
});

export const captureSchema = z.discriminatedUnion("kind", [
  taskCaptureSchema,
  eventCaptureSchema,
  deadlineCaptureSchema,
  timeCaptureSchema,
  noteSiblingCaptureSchema,
]);

export type ValidCapture = z.infer<typeof captureSchema>;

/** Form state returned by the primary-capture server actions in
 *  src/app/actions/captures.ts. Shape matches NoteFormState so
 *  composer components can share patterns. */
export type CaptureFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  /** Per-sibling field errors keyed by tempId. */
  attachmentErrors?: Record<string, Record<string, string[]>>;
};

export const captureInitialState: CaptureFormState = { status: "idle" };
