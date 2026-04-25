/**
 * Shared form-state shape for the "attach to note" composers
 * (task / deadline / time entry). Lives outside
 * `app/actions/note-attachments.ts` because `"use server"` files
 * can only export async functions.
 */

export type NoteAttachmentFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
};

export const noteAttachmentInitialState: NoteAttachmentFormState = {
  status: "idle",
};
