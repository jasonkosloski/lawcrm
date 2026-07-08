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

export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** OAuth scope required for two-way event sync. Connections made
 *  before this scope joined the connect flow lack it — gate on
 *  hasCalendarScope and prompt to reconnect. */
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of a Date's LOCAL calendar day — all-day events
 *  follow the repo's date-only convention (local midnight, see
 *  ADR-012), so local components are the intended day. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a Google all-day "date" (YYYY-MM-DD) to local midnight —
 *  same convention as parseLocalDate. */
function parseGoogleDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * CRM event → Google resource for insert/patch.
 *
 * All-day mapping: Google's all-day `end.date` is EXCLUSIVE (a
 * one-day event on the 5th is start 5th / end 6th). The CRM stores
 * all-day events as local-midnight instants on the day(s) they
 * cover with an INCLUSIVE end, so push adds a day.
 */
export function eventToGoogleResource(
  event: CrmEventFields & { id: string; zoomUrl?: string | null }
): GoogleEventResource {
  const descriptionParts = [
    event.description?.trim() || null,
    // Zoom URL folds into the description — Google's conferenceData
    // needs a conference solution we don't own.
    event.zoomUrl ? `Zoom: ${event.zoomUrl}` : null,
  ].filter(Boolean);

  return {
    summary: event.title,
    description: descriptionParts.length
      ? descriptionParts.join("\n\n")
      : undefined,
    location: event.location ?? undefined,
    start: event.isAllDay
      ? { date: localDateKey(event.startTime) }
      : { dateTime: event.startTime.toISOString() },
    end: event.isAllDay
      ? {
          date: localDateKey(new Date(event.endTime.getTime() + DAY_MS)),
        }
      : { dateTime: event.endTime.toISOString() },
    extendedProperties: { private: { [LAWCRM_MARKER_KEY]: event.id } },
  };
}

/**
 * Google resource → CRM fields for import/update. Returns null for
 * resources that can't map (cancelled handled by the caller;
 * missing times = malformed).
 *
 * All-day: Google's exclusive end.date maps back to the CRM's
 * inclusive end (minus one day), both at local midnight.
 */
export function googleEventToCrmFields(
  g: GoogleEventResource
): CrmEventFields | null {
  const startRaw = g.start?.dateTime ?? g.start?.date;
  const endRaw = g.end?.dateTime ?? g.end?.date;
  if (!startRaw || !endRaw) return null;

  const isAllDay = Boolean(g.start?.date);
  let startTime: Date;
  let endTime: Date;
  if (isAllDay) {
    startTime = parseGoogleDate(g.start!.date!);
    endTime = new Date(parseGoogleDate(g.end!.date!).getTime() - DAY_MS);
    if (endTime.getTime() < startTime.getTime()) endTime = startTime;
  } else {
    startTime = new Date(startRaw);
    endTime = new Date(endRaw);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()))
      return null;
  }

  return {
    // Google allows summary-less events; the CRM requires a title.
    title: g.summary?.trim() || "(no title)",
    description: g.description?.trim() || null,
    location: g.location?.trim() || null,
    startTime,
    endTime,
    isAllDay,
  };
}

/** CRM event id a pushed Google event carries, or null for events
 *  that didn't originate in the CRM. */
export function lawcrmIdOf(g: GoogleEventResource): string | null {
  return g.extendedProperties?.private?.[LAWCRM_MARKER_KEY] ?? null;
}
