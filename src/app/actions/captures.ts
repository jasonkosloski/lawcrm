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
 * TODO (auth): gate each action once RBAC lands.
 */

"use server";

import { revalidatePath } from "next/cache";
import DOMPurify from "isomorphic-dompurify";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  DEADLINE_KINDS,
  EVENT_TYPES,
  TASK_PRIORITIES,
} from "@/lib/note-constants";
import {
  captureSchema,
  type CaptureFormState,
  type ValidCapture,
} from "@/lib/capture-schemas";

// ── Shared helpers ──────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "span",
];
const ALLOWED_ATTR = ["href", "target", "rel", "class"];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  }).trim();
}

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Identifies the just-created primary record so sibling notes can
 *  link directly to it (e.g. a "court note" sibling on the Events
 *  composer gets its calendarEventId set to the event we just made). */
type PrimaryRef =
  | { kind: "task"; id: string }
  | { kind: "event"; id: string }
  | { kind: "deadline"; id: string }
  | { kind: "time"; id: string }
  | null;

async function createCaptureRecord(
  tx: Tx | Prisma.TransactionClient,
  cap: ValidCapture,
  matterId: string,
  userId: string,
  linkToPrimary: PrimaryRef = null
): Promise<void> {
  if (cap.kind === "task") {
    await tx.task.create({
      data: {
        matterId,
        title: cap.title,
        priority: cap.priority,
        dueDate: cap.dueDate ? new Date(cap.dueDate) : null,
        ownerId: userId,
      },
    });
  } else if (cap.kind === "event") {
    await tx.calendarEvent.create({
      data: {
        matterId,
        title: cap.title,
        type: cap.type,
        startTime: new Date(cap.startTime),
        endTime: new Date(cap.endTime),
        location: cap.location || null,
      },
    });
  } else if (cap.kind === "deadline") {
    await tx.deadline.create({
      data: {
        matterId,
        title: cap.title,
        dueDate: new Date(cap.dueDate),
        kind: cap.kind_,
        description: cap.description || null,
        ownerId: userId,
      },
    });
  } else if (cap.kind === "time") {
    await tx.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(cap.date),
        hours: Number(cap.hours),
        activity: cap.activity,
        narrative: cap.narrative || null,
        // When this time entry is a sibling of a freshly-created event,
        // link it so the event can surface the entry later.
        calendarEventId:
          linkToPrimary?.kind === "event" ? linkToPrimary.id : null,
        source: linkToPrimary?.kind === "event" ? "calendar" : "manual",
      },
    });
  } else if (cap.kind === "note_sibling") {
    const created = await tx.note.create({
      data: {
        matterId,
        authorId: userId,
        content: sanitize(cap.content),
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
  attachments: z.string().optional().default("[]"),
});

export async function createTaskWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
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

  const userId = await getCurrentUserId();

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        matterId,
        title: parsed.data.title,
        description: parsed.data.description || null,
        priority: parsed.data.priority,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        ownerId: userId,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, {
        kind: "task",
        id: task.id,
      });
    }
  });

  revalidateTouched(matterId, attach.captures, "task");
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
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: "Invalid start time",
      });
    }
    if (Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Invalid end time",
      });
    }
    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      end.getTime() < start.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "End must be after start",
      });
    }
  });

export async function createEventWithCaptures(
  matterId: string,
  _prev: CaptureFormState,
  formData: FormData
): Promise<CaptureFormState> {
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

  const userId = await getCurrentUserId();

  await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        matterId,
        title: parsed.data.title,
        type: parsed.data.type,
        startTime: new Date(parsed.data.startTime),
        endTime: new Date(parsed.data.endTime),
        location: parsed.data.location || null,
        description: parsed.data.description || null,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, {
        kind: "event",
        id: event.id,
      });
    }
  });

  revalidateTouched(matterId, attach.captures, "event");
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

  const userId = await getCurrentUserId();

  await prisma.$transaction(async (tx) => {
    const deadline = await tx.deadline.create({
      data: {
        matterId,
        title: parsed.data.title,
        dueDate: new Date(parsed.data.dueDate),
        kind: parsed.data.kind,
        sourceRef: parsed.data.sourceRef || null,
        description: parsed.data.description || null,
        ownerId: userId,
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, {
        kind: "deadline",
        id: deadline.id,
      });
    }
  });

  revalidateTouched(matterId, attach.captures, "deadline");
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

  const userId = await getCurrentUserId();

  await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.create({
      data: {
        matterId,
        userId,
        date: new Date(parsed.data.date),
        hours: Number(parsed.data.hours),
        activity: parsed.data.activity,
        narrative: parsed.data.narrative || null,
        billable: parsed.data.billable === "on",
        noCharge: parsed.data.noCharge === "on",
        privileged: parsed.data.privileged === "on",
        source: "manual",
      },
      select: { id: true },
    });
    for (const cap of attach.captures) {
      await createCaptureRecord(tx, cap, matterId, userId, {
        kind: "time",
        id: entry.id,
      });
    }
  });

  revalidateTouched(matterId, attach.captures, "time");
  return { status: "ok" };
}
