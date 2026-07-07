/**
 * Shared shapes + constants for the manual "Log a call" composer.
 * Lives outside `app/actions/calls.ts` because `"use server"` files
 * can only export async functions.
 *
 * Manual call logs reuse the messenger data model (MessengerThread /
 * MessengerItem with kind="call") so logged calls render inline with
 * future Quo-synced traffic — see the action header for the details.
 */

export type CallLogFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
};

/** Manual call logs are identified by this `providerEventId` prefix
 *  (`manual-<uuid>`). Only manual items are mutable — provider-synced
 *  items are immutable records of what happened on the line. */
export const MANUAL_CALL_PREFIX = "manual-";

/** True when a MessengerItem was created by the manual "Log a call"
 *  composer (vs synced from a phone provider). Gates edit/delete. */
export function isManualCallLog(providerEventId: string): boolean {
  return providerEventId.startsWith(MANUAL_CALL_PREFIX);
}

/** Client-side shape a manual call item is edited through — built by
 *  the server components that render call rows, consumed by the
 *  edit-mode composer (prefill) and the kebab menu (delete). */
export type EditableCallLog = {
  /** MessengerItem id. */
  id: string;
  /** Contact name (or formatted phone fallback) — the edit dialog
   *  shows it as a fixed chip; the contact itself can't be changed
   *  since it is the thread's identity. */
  contactLabel: string;
  direction: CallDirection;
  outcome: CallOutcome;
  occurredAt: Date;
  durationSec: number | null;
  /** Item-level filing only (a null here may still inherit the
   *  thread's default matter at read time). */
  matterId: string | null;
  /** Display name for `matterId` — lets the edit dialog keep the
   *  current filing selectable even when it's absent from the
   *  open-matter option list (e.g. the matter closed since). */
  matterName: string | null;
  summary: string | null;
};

export const callLogInitialState: CallLogFormState = { status: "idle" };

export const CALL_DIRECTIONS = ["outbound", "inbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/** Subset of MessengerItem.callStatus values that make sense for a
 *  manually logged call (provider statuses like `busy` / `failed`
 *  arrive only via webhooks). */
export const CALL_OUTCOMES = ["answered", "missed", "no_answer"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_DIRECTION_LABELS: Record<CallDirection, string> = {
  outbound: "Outbound — I called them",
  inbound: "Inbound — they called me",
};

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: "Answered",
  missed: "Missed",
  no_answer: "No answer",
};

/** Coerce a stored MessengerItem.callStatus into a composer outcome.
 *  Manual items only ever hold CALL_OUTCOMES values; the fallback is
 *  defensive for the (unreachable-today) non-manual path. */
export function asCallOutcome(callStatus: string | null): CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(callStatus ?? "")
    ? (callStatus as CallOutcome)
    : "answered";
}

/** Date → `datetime-local` input value (YYYY-MM-DDTHH:mm) in the
 *  runtime's local timezone. Used for "now" defaults and edit
 *  prefill — call it client-side so the browser TZ wins. */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Stored seconds → the composer's whole-minutes input value. Empty
 *  string for missed / unknown-duration calls. */
export function durationSecToMinutesInput(sec: number | null): string {
  if (sec === null || sec <= 0) return "";
  return String(Math.round(sec / 60));
}

/** Seconds → "45m" / "1h" / "1h 5m". Null for zero/unknown so
 *  callers can skip the chip entirely. */
export function formatCallDuration(durationSec: number | null): string | null {
  if (durationSec === null || durationSec <= 0) return null;
  const totalMin = Math.round(durationSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
