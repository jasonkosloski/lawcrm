/**
 * Nested-block rules shared by the template and block save actions.
 */

import type { AppliesTo } from "./schema";

/** How a scope reads in refusal messages. */
export const SCOPE_WORD: Record<AppliesTo, string> = {
  matter: "matter",
  lead: "lead",
  both: "matter-and-lead",
};
