/**
 * Shared form-state shape for the calendar event edit form.
 */

export type UpdateCalendarEventFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<
    Record<
      | "title"
      | "type"
      | "isAllDay"
      | "startTime"
      | "endTime"
      | "location"
      | "zoomUrl"
      | "description"
      | "attendees"
      | "visibility",
      string[]
    >
  >;
};

export const updateCalendarEventInitialState: UpdateCalendarEventFormState = {
  status: "idle",
};

/** Form state for `createCalendarEvent` (the standalone create
 *  on the calendar page). Kept here (not in the "use server"
 *  actions file) because Next 16's bundler emits non-async
 *  exports as runtime references and crashes with
 *  "X is not defined" when imported at render time. */
export type CreateCalendarEventState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<
    Record<
      | "title"
      | "type"
      | "isAllDay"
      | "startTime"
      | "endTime"
      | "location"
      | "zoomUrl"
      | "description"
      | "matterId"
      | "attendees"
      | "visibility",
      string[]
    >
  >;
  /** Server-issued id of the freshly-created event. */
  eventId?: string;
};

export const createCalendarEventInitialState: CreateCalendarEventState = {
  status: "idle",
};

/**
 * Normalize + validate the event's video-call link.
 *
 * Returns `""` for blank input, the (possibly https://-prefixed) URL
 * when it is an http(s) link, and `null` for anything else — `data:`,
 * `file:`, `javascript:`, malformed values. The link renders as a
 * clickable `<a href>` in the modal and is echoed into the Google
 * event description, so only web links are stored. A bare
 * `zoom.us/j/123` gets `https://` prepended instead of an error.
 * (Look-alike https hosts can't be told apart by a scheme check; this
 * is protocol hardening, not a phishing filter.)
 */
export function normalizeVideoUrl(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return "";
  // An explicit scheme: "word:" not followed by a port number
  // ("zoom.us:8443/j/1" is a host:port, not a scheme).
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v);
  const candidate = hasScheme ? v : `https://${v}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.length === 0) return null;
  return candidate;
}
