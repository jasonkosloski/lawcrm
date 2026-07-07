/**
 * Calendar event-type constants — client-safe (no Prisma imports).
 *
 * Canonical home for the CalendarEvent.type value set.
 * `src/lib/note-constants.ts` re-exports EVENT_TYPES for its
 * long-standing importers; new code should import from here.
 *
 * Note: the calendar UI also renders "deadline" pseudo-events
 * (deadlines projected onto the grid). That's a display-layer
 * concept, not a settable event type, so it isn't in this list —
 * render sites add their own label for it.
 */

export const EVENT_TYPES = [
  "meeting",
  "deposition",
  "hearing",
  "intake",
  "mediation",
  "block_time",
  "trial",
] as const;

export type CalendarEventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  meeting: "Meeting",
  deposition: "Deposition",
  hearing: "Hearing",
  intake: "Intake",
  mediation: "Mediation",
  block_time: "Block time",
  trial: "Trial",
};
