/**
 * Shared form-state shape for the calendar event edit form.
 */

export type UpdateCalendarEventFormState = {
  status: "idle" | "ok" | "error";
  errors?: Partial<
    Record<
      | "title"
      | "type"
      | "startTime"
      | "endTime"
      | "location"
      | "zoomUrl"
      | "description",
      string[]
    >
  >;
};

export const updateCalendarEventInitialState: UpdateCalendarEventFormState = {
  status: "idle",
};
