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
