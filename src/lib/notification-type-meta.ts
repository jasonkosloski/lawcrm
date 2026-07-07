/**
 * Notification type → presentation meta (icon + tone class).
 *
 * Shared by every surface that renders notification rows — the
 * topbar bell dropdown and the /notifications feed page — so a new
 * NotificationType gets its icon/tone in exactly one place. The
 * record is keyed by the full `NotificationType` union (type-only
 * import, erased at compile time, so this stays importable from
 * client components), which means adding a type to the union is a
 * compile error here until its meta lands too.
 *
 * DB rows store `type` as a plain string, so readers go through
 * `notificationTypeMeta()` which falls back to the generic meta for
 * unknown / legacy values instead of crashing the render.
 */

import {
  Calendar,
  CheckCircle2,
  CircleAlert,
  CircleX,
  ClipboardCheck,
  Coins,
  ListChecks,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import type { NotificationType } from "@/lib/notifications";

export type NotificationTypeMeta = {
  icon: React.ComponentType<{ size?: number }>;
  /** Tailwind text-color class applied to the icon chip. */
  tone: string;
};

export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  NotificationTypeMeta
> = {
  task_assigned: { icon: ClipboardCheck, tone: "text-brand-700" },
  task_due_soon: { icon: ListChecks, tone: "text-warn" },
  deadline_approaching: { icon: CircleAlert, tone: "text-warn" },
  deadline_overdue: { icon: CircleX, tone: "text-warn" },
  settlement_step_approved: { icon: CheckCircle2, tone: "text-ok" },
  settlement_step_rejected: { icon: CircleX, tone: "text-warn" },
  invoice_payment_recorded: { icon: Coins, tone: "text-ok" },
  note_mentioned: { icon: MessageSquare, tone: "text-ink-3" },
  matter_assigned: { icon: UserPlus, tone: "text-brand-700" },
  generic: { icon: Calendar, tone: "text-ink-3" },
};

/** Meta lookup for a DB-sourced type string — unknown values fall
 *  back to the generic meta rather than throwing. */
export function notificationTypeMeta(type: string): NotificationTypeMeta {
  return (
    NOTIFICATION_TYPE_META[type as NotificationType] ??
    NOTIFICATION_TYPE_META.generic
  );
}
