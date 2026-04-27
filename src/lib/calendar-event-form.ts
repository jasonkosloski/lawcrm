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
