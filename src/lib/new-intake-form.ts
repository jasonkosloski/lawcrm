/**
 * New intake form — state shape shared by /intake/new and
 * `createLead` (src/app/actions/leads.ts). Lives outside the
 * "use server" file because server-action modules may only export
 * async functions.
 */

export type NewIntakeFormState = {
  status: "idle" | "error";
  /** Field → messages. `_form` holds errors not tied to one field. */
  errors?: Record<string, string[]>;
  /** Echo of what was posted, so a failed submit keeps the draft. */
  values?: Record<string, string>;
};

export const newIntakeInitialState: NewIntakeFormState = { status: "idle" };

/** An existing contact the person can be linked to. */
export type IntakeContactOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: string;
};
