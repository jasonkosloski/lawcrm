/**
 * Shared constants + types for practice area + stage forms.
 *
 * Lives outside the `src/app/actions/practice-areas.ts` server-action
 * file because Next.js "use server" modules can only export async
 * functions — non-async exports break the build.
 */

export type PracticeAreaFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const practiceAreaInitialState: PracticeAreaFormState = {
  status: "idle",
};

export type StageFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const stageInitialState: StageFormState = { status: "idle" };
