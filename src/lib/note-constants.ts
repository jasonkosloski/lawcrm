/**
 * Shared constants + types for the Notes tab.
 *
 * Lives outside `src/app/actions/notes.ts` because the "use server"
 * file can only export async functions.
 */

export const NOTE_TYPES = ["note", "strategy", "memo", "chatter"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  note: "Note",
  strategy: "Strategy",
  memo: "Memo",
  chatter: "Chatter",
};

export type NoteFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
  /** Per-attachment errors keyed by tempId. Surfaced inline next to
   *  the offending sub-form so the user can fix it without losing
   *  everything else they typed. */
  attachmentErrors?: Record<string, Record<string, string[]>>;
};

export const noteInitialState: NoteFormState = { status: "idle" };

// ── Reactions ──────────────────────────────────────────────────────────

/** Curated palette of quick-react emojis. Kept small so the picker
 *  stays focused and the emoji column in the DB doesn't become a
 *  free-for-all. Order here is the order they appear in the picker. */
export const REACTION_EMOJIS = ["👍", "❤️", "✅", "🎉", "👀", "🔥"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// ── Captures (attached records) ────────────────────────────────────────

// Status / priority value sets moved to their canonical per-domain
// homes in `src/lib/constants/` (this file predates that layout and
// has ~50 importers). Re-exported here so existing imports keep
// working; new code should import from `@/lib/constants/*` directly.
export { TASK_PRIORITIES, type TaskPriority } from "@/lib/constants/priority";
export { TASK_STATUSES, type TaskStatus } from "@/lib/constants/task-status";
export {
  DEADLINE_STATUSES,
  DEADLINE_KINDS,
  type DeadlineStatus,
  type DeadlineKind,
} from "@/lib/constants/deadline-status";
export { TIME_ENTRY_STATUSES, type TimeEntryStatus } from "@/lib/constants/time-entry-status";
export { EVENT_TYPES, type CalendarEventType } from "@/lib/constants/calendar-event-type";

import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { EVENT_TYPES } from "@/lib/constants/calendar-event-type";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { todayKey } from "@/lib/format-date";
import { nextHourInTz } from "@/lib/event-schedule";

export type TaskCapture = {
  kind: "task";
  tempId: string;
  title: string;
  dueDate: string;
  priority: (typeof TASK_PRIORITIES)[number];
};

export type EventCapture = {
  kind: "event";
  tempId: string;
  title: string;
  startTime: string;
  endTime: string;
  type: (typeof EVENT_TYPES)[number];
  location: string;
};

export type DeadlineCapture = {
  kind: "deadline";
  tempId: string;
  title: string;
  dueDate: string;
  kind_: (typeof DEADLINE_KINDS)[number];
  description: string;
};

export type TimeCapture = {
  kind: "time";
  tempId: string;
  date: string;
  hours: string;
  activity: string;
  narrative: string;
};

export type NoteSiblingCapture = {
  kind: "note_sibling";
  tempId: string;
  content: string;
  type: NoteType;
  isPinned: boolean;
};

export type NoteCapture =
  TaskCapture | EventCapture | DeadlineCapture | TimeCapture | NoteSiblingCapture;

export type CaptureKind = NoteCapture["kind"];

export const CAPTURE_KIND_LABEL: Record<CaptureKind, string> = {
  task: "Task",
  event: "Event",
  deadline: "Deadline",
  time: "Time entry",
  note_sibling: "Note",
};

/** The runtime's own zone - what a form falls back to when the caller
 *  has no profile zone to pass (component tests, public pages). */
function runtimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Factory functions for new capture sub-forms — keep the shape
 *  consistent so the composer doesn't need to branch on kind. */
export function newCapture(
  kind: CaptureKind,
  tempId: string,
  /** Viewer's profile zone (`useUserTimeZone()`); drives the default
   *  date / time on new captures. */
  tz: string = runtimeZone(),
): NoteCapture {
  switch (kind) {
    case "task":
      return {
        kind: "task",
        tempId,
        title: "",
        dueDate: "",
        priority: "normal",
      };
    case "event":
      return {
        kind: "event",
        tempId,
        title: "",
        startTime: nextHourInTz(tz),
        endTime: nextHourInTz(tz, 1),
        type: "meeting",
        location: "",
      };
    case "deadline":
      return {
        kind: "deadline",
        tempId,
        title: "",
        dueDate: "",
        kind_: "manual",
        description: "",
      };
    case "time":
      return {
        kind: "time",
        tempId,
        date: todayKey(tz),
        hours: "",
        activity: "",
        narrative: "",
      };
    case "note_sibling":
      return {
        kind: "note_sibling",
        tempId,
        content: "",
        type: "note",
        isPinned: false,
      };
  }
}

// ── Viewer access (UI gating) ──────────────────────────────────────────

/**
 * What the signed-in viewer may do on the Notes surfaces, resolved
 * once on the server (see `getNoteAccess` in note-access.ts) and
 * passed down as plain booleans. The actions stay the enforcement
 * point; this only decides which controls to offer, so a user never
 * clicks a control that bounces them to the dashboard and throws away
 * what they typed.
 */
export type NoteAccess = {
  userId: string;
  /** notes.create - write notes and replies. */
  canCreateNote: boolean;
  /** notes.pin */
  canPin: boolean;
  /** notes.delete_any - delete other people's notes. */
  canDeleteAnyNote: boolean;
  /** notes.edit_any - edit other people's notes (authors always may). */
  canEditAnyNote: boolean;
  canCreateTask: boolean;
  canDeleteTask: boolean;
  canCreateDeadline: boolean;
  canDeleteDeadline: boolean;
  /** time_entries.create */
  canCreateTime: boolean;
  /** time_entries.delete_any - delete other people's time entries. */
  canDeleteAnyTime: boolean;
  canCreateEvent: boolean;
};

/** Fail-closed default: no viewer, nothing offered. */
export const NO_NOTE_ACCESS: NoteAccess = {
  userId: "",
  canCreateNote: false,
  canPin: false,
  canDeleteAnyNote: false,
  canEditAnyNote: false,
  canCreateTask: false,
  canDeleteTask: false,
  canCreateDeadline: false,
  canDeleteDeadline: false,
  canCreateTime: false,
  canDeleteAnyTime: false,
  canCreateEvent: false,
};

/** `kinds` narrowed to the capture kinds the viewer may create. */
export function allowedCaptureKinds(
  access: NoteAccess,
  kinds: readonly CaptureKind[],
): CaptureKind[] {
  const allowed: Record<CaptureKind, boolean> = {
    task: access.canCreateTask,
    deadline: access.canCreateDeadline,
    time: access.canCreateTime,
    event: access.canCreateEvent,
    note_sibling: access.canCreateNote,
  };
  return kinds.filter((k) => allowed[k]);
}
