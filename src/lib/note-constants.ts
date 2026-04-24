/**
 * Shared constants + types for the Notes tab.
 *
 * Lives outside `src/app/actions/notes.ts` because the "use server"
 * file can only export async functions.
 */

export const NOTE_TYPES = ["note", "strategy", "memo", "chatter"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  note: "Note",
  strategy: "Strategy",
  memo: "Memo",
  chatter: "Chatter",
};

export type NoteFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const noteInitialState: NoteFormState = { status: "idle" };
