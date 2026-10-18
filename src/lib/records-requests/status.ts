/**
 * Records request status rules. Pure, client-safe (no Prisma imports).
 *
 * Order matters: a non-terminal status may only move forward to a later
 * non-terminal status, and may close to any terminal status. A draft
 * leaves only by being sent. A terminal status may reopen to draft (if
 * never sent) or to a sent-or-later status (if sent).
 */

export const RECORDS_REQUEST_STATUSES = [
  "draft",
  "sent",
  "acknowledged",
  "partial",
  "complete",
  "denied",
  "withdrawn",
] as const;

export type RecordsRequestStatus = (typeof RECORDS_REQUEST_STATUSES)[number];

export const RECORDS_TERMINAL_STATUSES = [
  "complete",
  "denied",
  "withdrawn",
] as const satisfies readonly RecordsRequestStatus[];

export const RECORDS_STATUS_LABEL: Record<RecordsRequestStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  acknowledged: "Acknowledged",
  partial: "Partially received",
  complete: "Complete",
  denied: "Denied",
  withdrawn: "Withdrawn",
};

const TERMINAL = RECORDS_TERMINAL_STATUSES as readonly string[];

function isTerminal(status: RecordsRequestStatus): boolean {
  return TERMINAL.includes(status);
}

/** True for any non-terminal status. Unknown values are not open. */
export function isRecordsRequestOpen(status: string): boolean {
  return (RECORDS_REQUEST_STATUSES as readonly string[]).includes(status) &&
    !TERMINAL.includes(status);
}

export type RecordsTransitionResult =
  | { ok: true; reopen: boolean }
  | { ok: false };

export function checkRecordsTransition(
  from: RecordsRequestStatus,
  to: RecordsRequestStatus,
  /** `hasSentAt` matters only for reopening a terminal request
   *  (default true): a never-sent request reopens only to draft, a sent
   *  one only to a sent-or-later status. */
  opts: { hasSentAt?: boolean } = {},
): RecordsTransitionResult {
  if (from === to) return { ok: false };

  const fromTerminal = isTerminal(from);
  const toTerminal = isTerminal(to);

  if (fromTerminal) {
    // Terminal -> terminal is rejected; terminal -> open is a reopen.
    if (toTerminal) return { ok: false };
    const hasSentAt = opts.hasSentAt ?? true;
    if (hasSentAt === (to === "draft")) return { ok: false };
    return { ok: true, reopen: true };
  }

  // A draft leaves only by being sent, or closed as denied/withdrawn
  // (never "complete": nothing was requested yet).
  if (from === "draft") {
    return to === "sent" || to === "denied" || to === "withdrawn"
      ? { ok: true, reopen: false }
      : { ok: false };
  }

  // Non-terminal -> terminal: any close is allowed.
  if (toTerminal) return { ok: true, reopen: false };

  // Non-terminal -> non-terminal: forward only.
  const order = RECORDS_REQUEST_STATUSES as readonly string[];
  if (order.indexOf(to) > order.indexOf(from)) {
    return { ok: true, reopen: false };
  }
  return { ok: false };
}

/**
 * Open and past its response due date. `today` is the viewer's calendar
 * date as YYYY-MM-DD; a request due today is not yet overdue. Compared
 * as strings, which order the same as dates for YYYY-MM-DD.
 */
export function isRecordsRequestOverdue(
  r: { status: string; responseDueDate: Date | null },
  today: string,
): boolean {
  if (!r.responseDueDate) return false;
  if (!isRecordsRequestOpen(r.status)) return false;
  return r.responseDueDate.toISOString().slice(0, 10) < today;
}
