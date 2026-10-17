/**
 * Shared shapes + constants for the manual "Log a call" composer.
 * Lives outside `app/actions/calls.ts` because `"use server"` files
 * can only export async functions.
 *
 * Manual call logs reuse the messenger data model (MessengerThread /
 * MessengerItem with kind="call") so logged calls render inline with
 * future Quo-synced traffic — see the action header for the details.
 */

import { instantInTz, parseDateOnly, parseWallClock } from "@/lib/format-date";

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

/**
 * Parse the composer's `occurredAt` (a zone-less `datetime-local`
 * value such as "2026-06-10T14:30") as wall-clock time in the
 * submitting user's PROFILE zone (ADR-012). Never `new Date(value)`:
 * that reads the string in the server's zone (UTC in production), so
 * every logged call would land at the wrong instant and each edit-save
 * would shift it again.
 *
 * A tampered/stale POST can arrive date-only ("2026-06-10"); that is
 * pinned to midnight of that day in the user's zone rather than
 * drifting a day. Anything else (malformed, impossible date) → null so
 * the caller can return a field error. Prefill the edit input with
 * `toWallClockInput(instant, tz)` using the SAME zone.
 */
export function parseCallOccurredAt(value: string, tz: string): Date | null {
  const wall = parseWallClock(value, tz);
  if (wall) return wall;
  const day = parseDateOnly(value);
  if (!day) return null;
  return instantInTz(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    0,
    0,
    tz
  );
}

/** Stored seconds → the composer's whole-minutes input value. Empty
 *  string for missed / unknown-duration calls. */
export function durationSecToMinutesInput(sec: number | null): string {
  if (sec === null || sec <= 0) return "";
  return String(Math.round(sec / 60));
}

/** Seconds → "20s" / "45m" / "1h" / "1h 5m". Null for zero/unknown so
 *  callers can skip the chip entirely. Under a minute shows seconds
 *  (provider-synced calls can be a few seconds long; rounding those to
 *  whole minutes would read "0m"). */
export function formatCallDuration(durationSec: number | null): string | null {
  if (durationSec === null || durationSec <= 0) return null;
  if (durationSec < 60) return `${Math.max(1, Math.round(durationSec))}s`;
  const totalMin = Math.round(durationSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Call statuses that get the "missed" treatment (warn color,
 * PhoneMissed glyph, "Missed call" label) when the call is inbound.
 *
 * Value space is MessengerItem.callStatus: answered | missed |
 * voicemail | busy | failed | no_answer | declined.
 *
 * Included: `missed` and `no_answer` (caller rang out), plus
 * `declined` (a deliberately-rejected inbound call still means the
 * caller reached nobody and likely needs follow-up).
 *
 * Excluded by choice: `busy` and `failed` — those signal line or
 * network trouble on the connection itself rather than a caller the
 * firm failed to pick up, so they render neutrally.
 *
 * ONE definition shared by the inbox list, the thread reader and the
 * matter Phone log (they used to disagree). A missed call is by
 * definition inbound: an outbound "no answer" is an unanswered
 * attempt, not a missed call.
 */
export const MISSED_CALL_STATUSES: ReadonlySet<string> = new Set([
  "missed",
  "no_answer",
  "declined",
]);

/** True when an item (or thread preview) represents a missed call:
 *  an inbound call whose status is in MISSED_CALL_STATUSES. Pure —
 *  safe to use from client components. */
export function isMissedCall(
  direction: string | null,
  callStatus: string | null
): boolean {
  return (
    direction === "inbound" &&
    callStatus !== null &&
    MISSED_CALL_STATUSES.has(callStatus)
  );
}
