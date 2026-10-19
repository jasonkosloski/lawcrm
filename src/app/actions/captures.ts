/**
 * Primary-capture server actions.
 *
 * Mirror of `createNote` in src/app/actions/notes.ts — one action per
 * primary kind (task / event / deadline / time). Each parses the
 * primary form fields, the `attachments` JSON array of sibling
 * captures, validates everything, and creates the primary plus all
 * siblings in one Prisma transaction.
 *
 * Sibling creation logic is shared via `createCaptureRecord` so each
 * primary action stays focused on its own fields + revalidation.
 *
 * Auth: each entry-point gates on the primary's create permission
 * (tasks.create / events.create / deadlines.create /
 * time_entries.create) AND, before any write, on the create
 * permission of every sibling kind it carries (see
 * `requiredCapturePermissions`; a pinned sibling note also needs
 * notes.pin). Siblings do NOT inherit the primary's gate — denying
 * time_entries.create closes every time-logging entry point
 * (ADR-013). Admins short-circuit either way.
 *
 * `createLeadTask` / `createLeadEvent` are the intake-lead primaries
 * (same gates, no siblings) — see the section at the end.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// ADR-012: date-only inputs ("YYYY-MM-DD") are stored at UTC midnight
// via `parseDateOnly`; datetime-local values (event start/end) are
// wall-clock time in the USER's profile zone via `parseWallClock` —
// never `new Date(value)`, which would read them in the server's zone
// (UTC in production) and store a 9:00 AM hearing as 3:00 AM.
import { parseDateOnly, parseWallClock } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  requirePermission,
  requirePermissions,
} from "@/lib/permission-check";
import { requiredCapturePermissions } from "@/lib/capture-permissions";
import {
  addDefaultEventAttendees,
  resolveAutoAddTeam,
} from "@/lib/calendar-default-attendees";
import { pushEventToGoogle } from "@/lib/google/google-calendar-push";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { EVENT_TYPES } from "@/lib/constants/calendar-event-type";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import {
  captureSchema,
  checkEventTimes,
  type CaptureFormState,
  type ValidCapture,
} from "@/lib/capture-schemas";
import { auditEventTitle } from "@/lib/calendar-visibility";
import { logActivity } from "@/lib/activity-log";
import { isAssignableUser, notifyTaskAssigned } from "@/lib/task-assignment";
import { isKnownUtbmsCode } from "@/lib/time-entry-constants";
import { getEffectiveCalendarDefaults } from "@/lib/calendar-defaults";
import { textareaToHtml } from "@/lib/text-to-html";
import { scopePaths } from "@/lib/record-scope";
import type { LeadStage } from "@/lib/constants/lead-stage";
import { assertLeadAccess } from "@/lib/lead-access";

// ── Shared helpers ──────────────────────────────────────────────────────


/** Identifies the just-created primary record so sibling notes can
 *  link directly to it (e.g. a "court note" sibling on the Events
 *  composer gets its calendarEventId set to the event we just made). */
type PrimaryRef =
  | { kind: "task"; id: string }
  | { kind: "event"; id: string }
  | { kind: "deadline"; id: string }
  | { kind: "time"; id: string }
  | null;

/** Per-request context for sibling creation. `autoAddTeam` is the
 *  effective calendar default, resolved BEFORE the transaction;
 *  `tz` is the creator's profile zone (datetime-local values are
 *  wall-clock time in it), resolved BEFORE the transaction and only
 *  when an event sibling is attached (otherwise "UTC", never read);
 *  `createdEventIds` collects sibling events
 *  so the caller can push them to Google Calendar AFTER the commit
 *  (never inside the tx). */
type CaptureCtx = {
  autoAddTeam: boolean;
  tz: string;
  createdEventIds: string[];
};

async function buildCaptureCtx(
  matterId: string,
  captures: ValidCapture[]
): Promise<CaptureCtx> {
  return {
    autoAddTeam: await resolveAutoAddTeam(matterId, captures),
    tz: captures.some((c) => c.kind === "event")
      ? await getCurrentUserTimeZone()
      : "UTC",
    createdEventIds: [],
  };
}

/** A stale tab (or a tampered id) can post a matter that no longer
 *  exists; without this the create dies in a P2003 FK error and the
 *  form is replaced by the error boundary. Reported under the
 *  form-level `_form` key (rendered by CaptureComposerShell). */
async function matterMissing(matterId: string): Promise<boolean> {
  const m = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  return !m;
}

const MATTER_NOT_FOUND: Record<string, string[]> = {
  _form: ["This matter no longer exists. Reload the page."],
};

/** Push sibling/primary events to the creator's Google Calendar
 *  after the local commit. `pushEventToGoogle` never rejects. */
async function pushCreatedEvents(ids: string[]): Promise<void> {
  for (const id of ids) await pushEventToGoogle(id);
}

async function createCaptureRecord(
  tx: Tx,
  cap: ValidCapture,
  matterId: string,
  userId: string,
  ctx: CaptureCtx,
  linkToPrimary: PrimaryRef = null
): Promise<void> {
  if (cap.kind === "task") {
    await tx.task.create({
      data: {
        matterId,
        title: cap.title,
        priority: cap.priority,
        // Capture date fields are schema-validated as real YYYY-MM-DD
        // dates (see capture-schemas.ts), so parseDateOnly can't miss.
        dueDate: cap.dueDate ? parseDateOnly(cap.dueDate) : null,
        // Sibling task captures have no assignee picker — they
        // self-assign, which the actor-exclusion rule in
        // notifyTaskAssigned makes notification-silent by
        // construction. The PRIMARY task path (below) has a picker.
        ownerId: userId,
        // Sibling-capture link-back: if this task was created
        // alongside a primary event or deadline, point the FK back
        // so the spawned task surfaces under the primary AND the
        // task itself shows a "From event" / "From deadline" chip.
        eventId:
          linkToPrimary?.kind === "event" ? linkToPrimary.id : null,
        deadlineId:
          linkToPrimary?.kind === "deadline" ? linkToPrimary.id : null,
      },
    });
  } else if (cap.kind === "event") {
    // Same shape as the primary event path: a creator (so the push to
    // Google and the creator's edit rights work) plus the default
    // attendees (min-firm-attendee invariant).
    const ev = await tx.calendarEvent.create({
      data: {
        matterId,
        createdById: userId,
        title: cap.title,
        type: cap.type,
        // Schema-validated, so parseWallClock can't miss.
        startTime: parseWallClock(cap.startTime, ctx.tz)!,
        endTime: parseWallClock(cap.endTime, ctx.tz)!,
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
  } else if (cap.kind === "deadline") {
    await tx.deadline.create({
      data: {
        matterId,
        title: cap.title,
        dueDate: parseDateOnly(cap.dueDate)!,
        kind: cap.kind_,
        description: cap.description || null,
        ownerId: userId,
        // Sibling-capture link-back from a primary event.
        eventId:
          linkToPrimary?.kind === "event" ? linkToPrimary.id : null,
      },
    });
  } else if (cap.kind === "time") {
    await tx.timeEntry.create({
      data: {
        matterId,
        userId,
        date: parseDateOnly(cap.date)!,
        hours: Number(cap.hours),
        activity: cap.activity,
        narrative: cap.narrative || null,
        // When this time entry is a sibling of a freshly-created event,
        // link it so the event can surface the entry later.
        calendarEventId:
          linkToPrimary?.kind === "event" ? linkToPrimary.id : null,
        // Same link-backs as "Log time on this task/deadline"
        // (time-on-entity.ts), so the entry carries its "From task" /
        // "From deadline" chip and counts as time on that record.
        taskId: linkToPrimary?.kind === "task" ? linkToPrimary.id : null,
        deadlineId:
          linkToPrimary?.kind === "deadline" ? linkToPrimary.id : null,
        source:
          linkToPrimary?.kind === "event"
            ? "calendar"
            : linkToPrimary?.kind === "task"
              ? "task"
              : "manual",
      },
    });
  } else if (cap.kind === "note_sibling") {
    const created = await tx.note.create({
      data: {
        matterId,
        authorId: userId,
        // Plain <textarea> text: escape + <br>, NOT the HTML sanitizer
        // (which collapses line breaks and eats "<bracketed>" text).
        content: textareaToHtml(cap.content),
        type: cap.type,
        isPinned: cap.isPinned,
        taskId: linkToPrimary?.kind === "task" ? linkToPrimary.id : null,
        calendarEventId:
          linkToPrimary?.kind === "event" ? linkToPrimary.id : null,
        deadlineId:
          linkToPrimary?.kind === "deadline" ? linkToPrimary.id : null,
        timeEntryId: linkToPrimary?.kind === "time" ? linkToPrimary.id : null,
      },
      select: { id: true },
    });
    // Author auto-reads their own note so it doesn't show "unread"
    // to them on the next page load.
    await tx.noteRead.create({
      data: { userId, noteId: created.id },
    });
  }
}

/** Path-revalidate every tab whose data any of the captures (or the
 *  primary itself, if caller flags it via `primaryKind`) touched. */
function revalidateTouched(
  matterId: string,
  captures: ValidCapture[],
  primaryKind: "task" | "event" | "deadline" | "time"
): void {
  const kinds = new Set<string>([primaryKind, ...captures.map((c) => c.kind)]);
  revalidatePath(`/matters/${matterId}`);
  if (kinds.has("task")) revalidatePath(`/matters/${matterId}/tasks`);
  if (kinds.has("event")) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/calendar`);
  }
  if (kinds.has("deadline")) revalidatePath(`/matters/${matterId}/deadlines`);
  if (kinds.has("time")) revalidatePath(`/matters/${matterId}/time`);
  if (kinds.has("note_sibling"))
    revalidatePath(`/matters/${matterId}/notes`);
}

/** Parses + validates the JSON-encoded sibling array. Returns either
 *  a flat error map (for the form state) or the validated array. */
function parseAttachments(
  raw: string | undefined
):
  | { ok: true; captures: ValidCapture[] }
  | { ok: false; attachmentErrors: Record<string, Record<string, string[]>> } {
  let rawArr: unknown[] = [];
  try {
    const decoded = JSON.parse(raw ?? "[]");
    rawArr = Array.isArray(decoded) ? decoded : [];
  } catch {
    return { ok: false, attachmentErrors: {} };
  }

  const attachmentErrors: Record<string, Record<string, string[]>> = {};
  const validCaptures: ValidCapture[] = [];
  for (const a of rawArr) {
    const result = captureSchema.safeParse(a);
    if (!result.success) {
      const tempId =
        (a as { tempId?: unknown })?.tempId &&
        typeof (a as { tempId: unknown }).tempId === "string"
          ? ((a as { tempId: string }).tempId as string)
          : "unknown";
      attachmentErrors[tempId] = result.error.flatten().fieldErrors;
      continue;
    }
    validCaptures.push(result.data);
  }
  if (Object.keys(attachmentErrors).length > 0)
    return { ok: false, attachmentErrors };
  return { ok: true, captures: validCaptures };
}

// ── Task primary ────────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  dueDate: z.string().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  /** Assignee picker value. Tri-state: field ABSENT (legacy form
   *  without the picker) self-assigns like the old behavior; `""`
   *  (the "Unassigned" option) creates ownerless; a user id assigns
   *  (validated active in the action). */
  ownerId: z.string().optional(),
  attachments: z.string().optional().default("[]"),
});

export async function createTaskWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("tasks.create");
  await assertMatterAccess(matterId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const attach = parseAttachments(parsed.data.attachments);
  if (!attach.ok) {
    return {
      status: "error",
      errors: {},
      attachmentErrors: attach.attachmentErrors,
      values: raw,
    };
  }

  const dueDate = parsed.data.dueDate
    ? parseDateOnly(parsed.data.dueDate)
    : null;
  if (parsed.data.dueDate && !dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
      values: raw,
    };
  }

  // Every sibling kind must clear its own create gate BEFORE any
  // write (the primary's key was checked above).
  await requirePermissions(requiredCapturePermissions(attach.captures));
  if (await matterMissing(matterId)) {
    return { status: "error", errors: MATTER_NOT_FOUND, values: raw };
  }
  const userId = await getCurrentUserId();
  const ctx = await buildCaptureCtx(matterId, attach.captures);

  // Resolve the assignee picker's tri-state (see taskSchema):
  // absent → self-assign (pre-picker behavior), "" → unassigned,
  // id → that user, validated active. The actor is always
  // assignable to themselves — no lookup needed.
  const ownerId =
    parsed.data.ownerId === undefined
      ? userId
      : parsed.data.ownerId === ""
        ? null
        : parsed.data.ownerId;
  if (ownerId && ownerId !== userId && !(await isAssignableUser(ownerId))) {
    return {
      status: "error",
      errors: { ownerId: ["Assignee not found or inactive"] },
      values: raw,
    };
  }

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        matterId,
        title: parsed.data.title,
        description: parsed.data.description || null,
        priority: parsed.data.priority,
        dueDate,
        ownerId,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, ctx, {
        kind: "task",
        id: task.id,
      });
    }
  });

  await pushCreatedEvents(ctx.createdEventIds);
  revalidateTouched(matterId, attach.captures, "task");
  await logActivity({
    matterId,
    userId,
    type: "task",
    title: "Task added",
    detail: parsed.data.title,
  });
  // Create-time assignment pings the assignee exactly like a
  // reassignment would — same helper as setTaskOwner, so the
  // actor-exclusion rule (no self-ping) applies here too. After
  // the transaction: a failed notification never rolls back the
  // create.
  await notifyTaskAssigned({
    ownerId,
    actorId: userId,
    taskTitle: parsed.data.title,
    matterId,
  });
  return { status: "ok" };
}

// ── Event primary ───────────────────────────────────────────────────────

const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    type: z.enum(EVENT_TYPES).default("meeting"),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    location: z.string().max(200).optional().or(z.literal("")),
    description: z.string().max(4000).optional().or(z.literal("")),
    attachments: z.string().optional().default("[]"),
    /** Per-event visibility override — same shape as
     *  createCalendarEvent. "default" defers to the resolver
     *  (matter team sees by definition); "show_details" exposes
     *  the event firm-wide. */
    visibility: z
      .enum(["default", "show_details", "private"])
      .optional()
      .default("default"),
  })
  .superRefine(checkEventTimes);

export async function createEventWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("events.create");
  await assertMatterAccess(matterId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const attach = parseAttachments(parsed.data.attachments);
  if (!attach.ok) {
    return {
      status: "error",
      errors: {},
      attachmentErrors: attach.attachmentErrors,
      values: raw,
    };
  }

  await requirePermissions(requiredCapturePermissions(attach.captures));
  if (await matterMissing(matterId)) {
    return { status: "error", errors: MATTER_NOT_FOUND, values: raw };
  }
  const userId = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();

  // Resolve calendar defaults BEFORE the transaction so we can
  // skip the team query entirely when auto-add is off. The
  // resolver inherits matter override → firm setting; result
  // is a concrete boolean.
  const defaults = await getEffectiveCalendarDefaults(matterId);
  const ctx: CaptureCtx = {
    autoAddTeam: defaults.autoAddTeamToNewEvents,
    tz,
    createdEventIds: [],
  };

  const eventId = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        matterId,
        createdById: userId,
        title: parsed.data.title,
        type: parsed.data.type,
        // Wall-clock time in the creator's zone (schema-validated).
        startTime: parseWallClock(parsed.data.startTime, tz)!,
        endTime: parseWallClock(parsed.data.endTime, tz)!,
        location: parsed.data.location || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, ctx, {
        kind: "event",
        id: event.id,
      });
    }
    // Default attendees (matter team when auto-add is on, creator
    // always) — shared with the sibling-event paths.
    await addDefaultEventAttendees(tx, {
      eventId: event.id,
      matterId,
      userId,
      autoAddTeam: defaults.autoAddTeamToNewEvents,
    });
    return event.id;
  });

  // Google Calendar push — after the local commit, like the
  // calendar-events.ts create path. Never rejects.
  await pushCreatedEvents([eventId, ...ctx.createdEventIds]);

  revalidateTouched(matterId, attach.captures, "event");
  await logActivity({
    matterId,
    userId,
    type: "event",
    title: "Event scheduled",
    detail: auditEventTitle(parsed.data.visibility, parsed.data.title),
  });
  return { status: "ok" };
}

// ── Deadline primary ────────────────────────────────────────────────────

const deadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string().min(1, "Due date is required"),
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  sourceRef: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(4000).optional().or(z.literal("")),
  attachments: z.string().optional().default("[]"),
});

export async function createDeadlineWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("deadlines.create");
  await assertMatterAccess(matterId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = deadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const attach = parseAttachments(parsed.data.attachments);
  if (!attach.ok) {
    return {
      status: "error",
      errors: {},
      attachmentErrors: attach.attachmentErrors,
      values: raw,
    };
  }

  const dueDate = parseDateOnly(parsed.data.dueDate);
  if (!dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
      values: raw,
    };
  }

  await requirePermissions(requiredCapturePermissions(attach.captures));
  if (await matterMissing(matterId)) {
    return { status: "error", errors: MATTER_NOT_FOUND, values: raw };
  }
  const userId = await getCurrentUserId();
  const ctx = await buildCaptureCtx(matterId, attach.captures);

  await prisma.$transaction(async (tx) => {
    const deadline = await tx.deadline.create({
      data: {
        matterId,
        title: parsed.data.title,
        dueDate,
        kind: parsed.data.kind,
        sourceRef: parsed.data.sourceRef || null,
        description: parsed.data.description || null,
        ownerId: userId,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, ctx, {
        kind: "deadline",
        id: deadline.id,
      });
    }
  });

  await pushCreatedEvents(ctx.createdEventIds);
  revalidateTouched(matterId, attach.captures, "deadline");
  await logActivity({
    matterId,
    userId,
    type: "deadline",
    title: "Deadline added",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

// ── Time primary ────────────────────────────────────────────────────────

const timeEntrySchema = z.object({
  date: z.string().min(1, "Date is required"),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  // Catalog-validated so junk can't reach the column that later
  // feeds LEDES/insurer exports. Empty = "no code".
  utbmsCode: z
    .string()
    .trim()
    .refine((v) => v === "" || isKnownUtbmsCode(v), "Unknown UTBMS code")
    .optional(),
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
  attachments: z.string().optional().default("[]"),
});

export async function createTimeEntryWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("time_entries.create");
  await assertMatterAccess(matterId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const attach = parseAttachments(parsed.data.attachments);
  if (!attach.ok) {
    return {
      status: "error",
      errors: {},
      attachmentErrors: attach.attachmentErrors,
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

  await requirePermissions(requiredCapturePermissions(attach.captures));
  if (await matterMissing(matterId)) {
    return { status: "error", errors: MATTER_NOT_FOUND, values: raw };
  }
  const userId = await getCurrentUserId();
  const ctx = await buildCaptureCtx(matterId, attach.captures);

  await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.create({
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
        source: "manual",
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, ctx, {
        kind: "time",
        id: entry.id,
      });
    }
  });

  await pushCreatedEvents(ctx.createdEventIds);
  revalidateTouched(matterId, attach.captures, "time");
  await logActivity({
    matterId,
    userId,
    type: "time_entry",
    title: `Time logged · ${parsed.data.hours}h`,
    detail: parsed.data.activity,
  });
  return { status: "ok" };
}

// ── Intake (lead) primaries ─────────────────────────────────────────────
//
// Task and event on an intake lead (Task.leadId / CalendarEvent.leadId,
// see src/lib/record-scope.ts) — the /intake/[id]/tasks and /events
// composers. Same fields, gates and validation as the matter
// primaries above, but no sibling captures: a lead has no matter for
// deadlines, time or notes to land on. Refused once the lead has
// converted — its tasks and events moved to the matter.

const LEAD_CONVERTED = "converted" satisfies LeadStage;

/** Form-level error for a lead that can't take new records, or null. */
async function leadWriteError(
  leadId: string
): Promise<Record<string, string[]> | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { stage: true },
  });
  if (!lead) return { _form: ["This lead no longer exists. Reload the page."] };
  if (lead.stage === LEAD_CONVERTED) {
    return {
      _form: [
        "This lead is already converted — add this on the matter instead.",
      ],
    };
  }
  return null;
}

/** The lead composers never send siblings; refuse rather than drop. */
const NO_LEAD_CAPTURES: Record<string, string[]> = {
  _form: [
    "Intake tasks and events can't carry other items — add those once the lead is a matter.",
  ],
};

function revalidateLead(leadId: string, tab: "tasks" | "events"): void {
  for (const path of scopePaths({ kind: "lead", leadId }, tab)) {
    revalidatePath(path);
  }
  revalidatePath("/"); // dashboard "Your tasks" / "Today's agenda"
  if (tab === "events") revalidatePath("/calendar");
}

export async function createLeadTask(
  leadId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("tasks.create");
  // Restricted intake: 404 unless the viewer may see this lead (ADR-049).
  await assertLeadAccess(leadId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  if (parsed.data.attachments !== "[]") {
    return { status: "error", errors: NO_LEAD_CAPTURES, values: raw };
  }

  const dueDate = parsed.data.dueDate
    ? parseDateOnly(parsed.data.dueDate)
    : null;
  if (parsed.data.dueDate && !dueDate) {
    return {
      status: "error",
      errors: { dueDate: ["Invalid due date"] },
      values: raw,
    };
  }

  const leadError = await leadWriteError(leadId);
  if (leadError) return { status: "error", errors: leadError, values: raw };
  const userId = await getCurrentUserId();

  // Same assignee tri-state as createTaskWithCaptures.
  const ownerId =
    parsed.data.ownerId === undefined
      ? userId
      : parsed.data.ownerId === ""
        ? null
        : parsed.data.ownerId;
  if (ownerId && ownerId !== userId && !(await isAssignableUser(ownerId))) {
    return {
      status: "error",
      errors: { ownerId: ["Assignee not found or inactive"] },
      values: raw,
    };
  }

  await prisma.task.create({
    data: {
      leadId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      dueDate,
      ownerId,
    },
  });

  revalidateLead(leadId, "tasks");
  // Lead-scoped: no matter to hang the row on (like firm-wide tasks).
  await logActivity({
    matterId: null,
    userId,
    type: "task",
    title: "Intake task added",
    detail: parsed.data.title,
  });
  await notifyTaskAssigned({
    ownerId,
    actorId: userId,
    taskTitle: parsed.data.title,
    matterId: null,
    leadId,
  });
  return { status: "ok" };
}

export async function createLeadEvent(
  leadId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
  await requirePermission("events.create");
  // Restricted intake: 404 unless the viewer may see this lead (ADR-049).
  await assertLeadAccess(leadId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }
  if (parsed.data.attachments !== "[]") {
    return { status: "error", errors: NO_LEAD_CAPTURES, values: raw };
  }

  const leadError = await leadWriteError(leadId);
  if (leadError) return { status: "error", errors: leadError, values: raw };
  const userId = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();

  const eventId = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        leadId,
        createdById: userId,
        title: parsed.data.title,
        type: parsed.data.type,
        // Wall-clock time in the creator's zone (schema-validated).
        startTime: parseWallClock(parsed.data.startTime, tz)!,
        endTime: parseWallClock(parsed.data.endTime, tz)!,
        location: parsed.data.location || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      },
      select: { id: true },
    });
    // A lead has no team: the creator is the only default attendee.
    await addDefaultEventAttendees(tx, {
      eventId: event.id,
      matterId: null,
      userId,
      autoAddTeam: false,
    });
    return event.id;
  });

  await pushCreatedEvents([eventId]);
  revalidateLead(leadId, "events");
  await logActivity({
    matterId: null,
    userId,
    type: "event",
    title: "Intake event scheduled",
    detail: auditEventTitle(parsed.data.visibility, parsed.data.title),
  });
  return { status: "ok" };
}
