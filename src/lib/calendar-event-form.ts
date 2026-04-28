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

/** Form state for `createPersonalEvent` — kept here (not in
 *  the "use server" actions file) because Next 16's bundler
 *  emits non-async exports as runtime references and crashes
 *  with "X is not defined" when imported at render time. */
export type CreatePersonalEventState = {
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
      | "description",
      string[]
    >
  >;
  /** Server-issued id of the freshly-created event. */
  eventId?: string;
};

export const createPersonalEventInitialState: CreatePersonalEventState = {
  status: "idle",
};
