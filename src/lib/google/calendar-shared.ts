/**
 * Google Calendar sync — the shared contract between the PULL engine
 * (google-calendar-sync.ts) and the PUSH hooks (google-calendar-push.ts).
 * Both directions must agree on the resource mapping and the echo
 * marker, so those live here as pure, dependency-free functions.
 *
 * Design decisions (v1):
 *  - Each user syncs their own "primary" Google calendar through
 *    their Google connection (the EmailAccount row doubles as the
 *    Google account record). Mapping rows live in CalendarEventSync,
 *    unique per (eventId, accountId) and (accountId, googleEventId).
 *  - Echo-loop prevention: events we push carry the CRM event id in
 *    extendedProperties.private[LAWCRM_MARKER_KEY]. The pull engine
 *    treats marked events as "ours" (update-by-mapping, never
 *    re-import as new).
 *  - We NEVER send attendees to Google: Google emails invites on the
 *    owner's behalf the moment an attendee list appears — a firm
 *    calendar quietly emailing opposing counsel is a malpractice
 *    generator. The CRM's attendee model stays internal.
 *  - Conflict policy: last-write-wins by updated timestamp
 *    (CalendarEventSync.googleUpdatedAt vs CalendarEvent.updatedAt).
 */

import { stripNul } from "@/lib/google/strip-nul";
import { addDaysToKey, dateOnlyKey, parseDateOnly } from "@/lib/format-date";

export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** OAuth scope required for two-way event sync. Connections made
 *  before this scope joined the connect flow lack it — gate on
 *  hasCalendarScope and prompt to reconnect. */
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** extendedProperties.private key carrying the CRM event id. */
export const LAWCRM_MARKER_KEY = "lawcrmEventId";

export function hasCalendarScope(grantedScopes: string | null): boolean {
  if (!grantedScopes) return false;
  return grantedScopes.split(/\s+/).includes(CALENDAR_EVENTS_SCOPE);
}

/** The slice of a Google event resource both engines touch. */
export type GoogleEventResource = {
  id?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  updated?: string;
  /** Google event visibility: "default" | "public" | "private" | "confidential". */
  visibility?: string;
  extendedProperties?: { private?: Record<string, string> };
};

/** The CRM-side fields the mapping cares about. */
export type CrmEventFields = {
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
};

/**
 * Deterministic Google event id for a CRM event, used on INSERT so a
 * retried/lost insert is idempotent (Google answers 409 for an id
 * that already exists instead of minting a duplicate). Google ids
 * must be 5-1024 chars of lowercase base32hex (a-v, 0-9); a CRM id
 * (cuid: a-z0-9) is not itself valid (w-z), so the id's UTF-8 bytes
 * are base32hex-encoded (no padding).
 */
export function googleEventIdFor(crmEventId: string): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of Buffer.from(crmEventId, "utf8")) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  // Google's minimum is 5 characters; any real CRM id is far longer.
  return out.padEnd(5, "0");
}

/**
 * CRM event → Google resource for insert/patch.
 *
 * All-day mapping: Google's all-day `end.date` is EXCLUSIVE (a
 * one-day event on the 5th is start 5th / end 6th). The CRM stores
 * all-day events as date-only values (UTC midnight, ADR-012) on the
 * day(s) they cover with an INCLUSIVE end, so push adds a day — in
 * day-key arithmetic, which has no DST days. Rows written before
 * ADR-012 was revised sit at server-local midnight; those still
 * read as the right UTC day.
 */
export function eventToGoogleResource(
  event: CrmEventFields & {
    id: string;
    zoomUrl?: string | null;
    /** CRM visibility; "private" pushes as a Google private event. */
    visibility?: string | null;
  },
): GoogleEventResource {
  const body = event.description?.trim() || null;
  const zoomLine = event.zoomUrl ? `Zoom: ${event.zoomUrl}` : null;
  const descriptionParts = [
    body,
    // Zoom URL folds into the description — Google's conferenceData
    // needs a conference solution we don't own. Not appended twice:
    // a description that already ends with the line (rows polluted
    // before the pull learned to strip it) must not keep growing.
    zoomLine && !body?.endsWith(zoomLine) ? zoomLine : null,
  ].filter(Boolean);

  return {
    summary: event.title,
    // EMPTY STRINGS, not undefined: JSON.stringify drops undefined
    // keys, so a PATCH after the user cleared the field in the CRM
    // would leave Google's old value in place (and the next pull
    // would restore it). "" clears it on PATCH and is accepted on
    // insert.
    description: descriptionParts.join("\n\n"),
    location: event.location ?? "",
    start: event.isAllDay
      ? { date: dateOnlyKey(event.startTime) }
      : { dateTime: event.startTime.toISOString() },
    end: event.isAllDay
      ? { date: addDaysToKey(dateOnlyKey(event.endTime), 1) }
      : { dateTime: event.endTime.toISOString() },
    // A CRM-private event is pushed as a Google PRIVATE event, so
    // anyone with only free/busy or "see all event details" access to
    // the creator's calendar sees Busy, never the title. Everything
    // else resets to the calendar default (also un-privates a copy
    // when the CRM toggle is turned off).
    visibility: event.visibility === "private" ? "private" : "default",
    extendedProperties: { private: { [LAWCRM_MARKER_KEY]: event.id } },
  };
}

/**
 * Google resource → CRM fields for import/update. Returns null for
 * resources that can't map (cancelled handled by the caller;
 * missing times = malformed).
 *
 * All-day: Google's exclusive end.date maps back to the CRM's
 * inclusive end (minus one day), both date-only (UTC midnight).
 * A malformed `date` makes the resource unmappable (null).
 */
export function googleEventToCrmFields(g: GoogleEventResource): CrmEventFields | null {
  const startRaw = g.start?.dateTime ?? g.start?.date;
  const endRaw = g.end?.dateTime ?? g.end?.date;
  if (!startRaw || !endRaw) return null;

  const isAllDay = Boolean(g.start?.date);
  let startTime: Date;
  let endTime: Date;
  if (isAllDay) {
    const start = parseDateOnly(g.start!.date!);
    const endExclusive = g.end?.date ? parseDateOnly(g.end.date) : null;
    if (!start || !endExclusive) return null;
    const inclusiveEnd = parseDateOnly(addDaysToKey(dateOnlyKey(endExclusive), -1));
    startTime = start;
    endTime = inclusiveEnd ?? start;
    if (endTime.getTime() < startTime.getTime()) endTime = startTime;
  } else {
    startTime = new Date(startRaw);
    endTime = new Date(endRaw);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null;
  }

  return {
    // Google allows summary-less events; the CRM requires a title.
    // NUL stripped — Postgres text rejects U+0000.
    title: stripNul(g.summary ?? "").trim() || "(no title)",
    description: stripNul(g.description ?? "").trim() || null,
    location: stripNul(g.location ?? "").trim() || null,
    startTime,
    endTime,
    isAllDay,
  };
}

/**
 * Undo the push-side Zoom fold on a description pulled back from
 * Google. `eventToGoogleResource` appends `Zoom: <zoomUrl>` to the
 * description; without stripping it on the way back, the pull would
 * write it into the CRM description and the next push would add
 * another. Strips every trailing copy (earlier builds stacked them).
 * Returns null when nothing but the Zoom line remains.
 */
export function stripZoomLine(
  description: string | null,
  zoomUrl: string | null | undefined,
): string | null {
  if (!description || !zoomUrl) return description;
  const line = `Zoom: ${zoomUrl}`;
  let d = description.trimEnd();
  while (d.endsWith(line)) {
    d = d.slice(0, d.length - line.length).trimEnd();
  }
  return d.trim() ? d : null;
}

/** CRM event id a pushed Google event carries, or null for events
 *  that didn't originate in the CRM. */
export function lawcrmIdOf(g: GoogleEventResource): string | null {
  return g.extendedProperties?.private?.[LAWCRM_MARKER_KEY] ?? null;
}
