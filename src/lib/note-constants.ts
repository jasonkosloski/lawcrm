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
export {
  TASK_PRIORITIES,
  type TaskPriority,
} from "@/lib/constants/priority";
export {
  TASK_STATUSES,
  type TaskStatus,
} from "@/lib/constants/task-status";
export {
  DEADLINE_STATUSES,
  DEADLINE_KINDS,
  type DeadlineStatus,
  type DeadlineKind,
} from "@/lib/constants/deadline-status";
export {
  TIME_ENTRY_STATUSES,
  type TimeEntryStatus,
} from "@/lib/constants/time-entry-status";
export {
  EVENT_TYPES,
  type CalendarEventType,
} from "@/lib/constants/calendar-event-type";

import { TASK_PRIORITIES } from "@/lib/constants/priority";
import { EVENT_TYPES } from "@/lib/constants/calendar-event-type";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";

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
  | TaskCapture
  | EventCapture
  | DeadlineCapture
  | TimeCapture
  | NoteSiblingCapture;

export type CaptureKind = NoteCapture["kind"];

export const CAPTURE_KIND_LABEL: Record<CaptureKind, string> = {
  task: "Task",
  event: "Event",
  deadline: "Deadline",
  time: "Time entry",
  note_sibling: "Note",
};

/** Today's date in YYYY-MM-DD form — the local-timezone "today" is
 *  what users expect when they open a capture form. */
export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Round now up to the next :00 in local time, formatted for
 *  datetime-local inputs (YYYY-MM-DDTHH:mm). */
export function nextHourDateTimeString(addHours = 0): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1 + addHours);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** Factory functions for new capture sub-forms — keep the shape
 *  consistent so the composer doesn't need to branch on kind. */
export function newCapture(kind: CaptureKind, tempId: string): NoteCapture {
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
        startTime: nextHourDateTimeString(),
        endTime: nextHourDateTimeString(1),
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
        date: todayDateString(),
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
