/**
 * Shared form-state shape for the contact create/edit form.
 */

export type ContactFormState = {
  status: "idle" | "ok" | "error";
  /** When the action redirects, this carries the new contact id so the
   *  client can navigate. (For edit it stays null.) */
  contactId?: string;
  errors?: Partial<
    Record<
      | "name"
      | "type"
      | "email"
      | "phone"
      | "organization"
      | "address"
      | "city"
      | "state"
      | "zip"
      | "notes"
      | "conflictStatus"
      | "_form",
      string[]
    >
  >;
};

export const contactFormInitialState: ContactFormState = { status: "idle" };
