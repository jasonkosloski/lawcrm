/**
 * Shared schedule + video-link helpers for the calendar's event forms
 * (detail modal, full-page create form, docked quick composer).
 *
 * Before this module each form re-implemented its own `dateOnly` /
 * `withDefaultStart` / local-getter `toDateTimeInput`, with subtly
 * different rules and the browser-local time bug in each copy.
 *
 * ADR-012 contract (the wire format the calendar actions parse):
 *   - timed events travel as a datetime-local wall-clock string
 *     ("YYYY-MM-DDTHH:mm") in the USER's profile zone;
 *   - all-day events travel as a date-only key ("YYYY-MM-DD").
 * Form state holds both as one datetime-local-shaped string so the
 * same field can flip between the two modes; all-day values sit at
 * `T00:00` and are sliced to the date half on submit.
 */

import { dateOnlyKey, parseWallClock, toWallClockInput } from "@/lib/format-date";

/** Date half of a `YYYY-MM-DDTHH:mm` (or bare `YYYY-MM-DD`) value. */
export const dateOnly = (v: string): string => v.slice(0, 10);

/** True when the value is a bare date or sits at midnight — the
 *  all-day placeholder time. */
const isDayOnly = (v: string): boolean => v.length === 10 || v.endsWith("T00:00");

/** Reseed for the all-day → timed toggle: midnight becomes 9am so
 *  the user doesn't land on 00:00 inputs. Real times pass through. */
export const withDefaultStart = (v: string): string => (isDayOnly(v) ? `${dateOnly(v)}T09:00` : v);
/** Same for the end boundary (10am, one hour after the start). */
export const withDefaultEnd = (v: string): string => (isDayOnly(v) ? `${dateOnly(v)}T10:00` : v);

/**
 * Form-state string for a stored boundary.
 *
 * All-day boundaries are date-only values (UTC midnight) and read by
 * their UTC calendar date — never shifted by any zone. Timed
 * boundaries are instants and read as wall-clock time in `tz`.
 */
export function toScheduleInput(d: Date, isAllDay: boolean, tz: string): string {
  return isAllDay ? `${dateOnlyKey(d)}T00:00` : toWallClockInput(d, tz);
}

/** The wire value for a boundary held in form state. */
export const toScheduleWire = (value: string, isAllDay: boolean): string =>
  isAllDay ? dateOnly(value) : value;

/**
 * The next top-of-hour (plus `addHours`) as a datetime-local value on
 * the wall clock of `tz` — the default start/end of a new event, task
 * or capture. At 2:20 PM it returns 3:00 PM, and at exactly 3:00 PM,
 * 4:00 PM. Steps from the start of the current wall-clock hour in real
 * time (half-hour zones and DST included), and never depends on the
 * browser or server zone; the server reads the value back with
 * `parseWallClock(value, tz)`.
 */
export function nextHourInTz(tz: string, addHours = 0, now: Date = new Date()): string {
  const wall = toWallClockInput(now, tz); // YYYY-MM-DDTHH:mm
  const hourStart = parseWallClock(`${wall.slice(0, 13)}:00`, tz) ?? now;
  let next = hourStart.getTime() + (1 + addHours) * HOUR_MS;
  // In the repeated hour after a fall-back, the wall time is ambiguous
  // and reads back as its earlier (already past) occurrence; step on
  // until the value the server will parse is actually in the future.
  while (
    (parseWallClock(toWallClockInput(new Date(next), tz), tz)?.getTime() ?? next) <= now.getTime()
  ) {
    next += HOUR_MS;
  }
  return toWallClockInput(new Date(next), tz);
}

const HOUR_MS = 3_600_000;

// ── Video links ─────────────────────────────────────────────────────────

export type VideoUrlResult = { ok: true; value: string } | { ok: false; error: string };

export const VIDEO_URL_ERROR = "Enter a valid video link (http or https).";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
// "zoom.us:8443/j/1" looks like a scheme to SCHEME_RE but is host:port.
const HOST_PORT_RE = /^[^/\s:]+:\d+(?:[/?#]|$)/;

/**
 * Normalize what a user pasted into a video-link field. Empty stays
 * empty; a scheme-less value ("zoom.us/j/8123", common in invites)
 * gets `https://`; anything that isn't an http(s) URL with a dotted
 * host is rejected so a typo can't become a relative link that 404s
 * minutes before a hearing.
 */
export function normalizeVideoUrl(raw: string): VideoUrlResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: "" };
  const candidate =
    SCHEME_RE.test(trimmed) && !HOST_PORT_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: VIDEO_URL_ERROR };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: VIDEO_URL_ERROR };
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    return { ok: false, error: VIDEO_URL_ERROR };
  }
  return { ok: true, value: candidate };
}

/** An href safe to render for a stored video link, or null when the
 *  stored (possibly legacy, free-text) value isn't a usable link. */
export function videoHref(value: string): string | null {
  const res = normalizeVideoUrl(value);
  return res.ok && res.value !== "" ? res.value : null;
}
