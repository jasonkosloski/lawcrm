/**
 * Whether one notification row should be emailed now, held for the
 * daily digest, or never emailed. Pure: the delivery worker
 * (src/lib/notification-email.ts) gathers the inputs.
 */

import {
  categoryMeta,
  type EmailMode,
  type NotificationCategory,
} from "@/lib/notification-categories";

export type EmailDecision = "send" | "hold" | "skip";

export type EmailDecisionInput = {
  userActive: boolean;
  /** The recipient already read it in the app. */
  read: boolean;
  /** True for rows with no matter. */
  hasMatterAccess: boolean;
  category: NotificationCategory;
  /** Already resolved with `effectiveMode` (never "off" for deadlines). */
  mode: EmailMode;
  /** The recipient muted email for the row's matter. */
  muted: boolean;
};

export function decideEmail(i: EmailDecisionInput): EmailDecision {
  if (!i.userActive || i.read || !i.hasMatterAccess) return "skip";
  if (i.mode === "off") return "skip";
  if (i.muted && categoryMeta(i.category).honoursMute) return "skip";
  return i.mode === "digest" ? "hold" : "send";
}
