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
      | "attendees",
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
