/**
 * Automations (deadline rules, task lists, defaults) — form state +
 * result shapes shared between `src/app/actions/automations.ts` and
 * the client forms. Lives outside the "use server" file because
 * server-action modules may only export async functions.
 */

export type AutomationFormState = {
  status: "idle" | "ok" | "error";
  /** Field → messages. `_form` holds errors not tied to one field. */
  errors?: Record<string, string[]>;
};

export const automationInitialState: AutomationFormState = { status: "idle" };

/** One task-list item as the editor posts it (JSON in `items`). */
export type TaskListItemInput = {
  title: string;
  description?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  assignTo?: "lead" | "unassigned";
  /** Days after the list is applied; null/undefined = undated. */
  dueOffsetDays?: number | null;
};

/** Result of applying one deadline rule to a matter by hand. */
export type ApplyRuleResult =
  | { status: "ok"; title: string; dueKey: string }
  /** The rule is already on the matter — resend with force. */
  | { status: "duplicate"; title: string }
  /** The anchor couldn't be resolved — resend with a date. */
  | { status: "needs_date"; title: string; reason: string; label: string }
  | { status: "error"; error: string };

/** Result of applying one task list to a matter by hand. */
export type ApplyTaskListResult =
  | { status: "ok"; name: string; count: number }
  | { status: "duplicate"; name: string }
  | { status: "error"; error: string };
