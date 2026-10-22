/**
 * Notification type → email category.
 *
 * Users choose an email mode per CATEGORY, not per type, on
 * /settings/notifications. `CATEGORY_BY_TYPE` is keyed by the full
 * `NotificationType` union (type-only import, so this stays importable
 * from client components), which makes adding a type a compile error
 * here until it gets a category. DB rows store `type` as a plain
 * string, so readers go through `categoryOf()`, which falls back to
 * "other" for unknown / legacy values.
 *
 * Deadline reminders are a malpractice guard: they can be Instant or
 * Daily digest but never Off, and a matter mute does not silence them.
 */

import type { NotificationType } from "@/lib/notifications";

export type NotificationCategory =
  "deadlines" | "tasks" | "settlement" | "billing" | "matter_team" | "portal" | "other";

export type EmailMode = "off" | "instant" | "digest";

const ALL_MODES: readonly EmailMode[] = ["off", "instant", "digest"];

export type NotificationCategoryMeta = {
  key: NotificationCategory;
  label: string;
  description: string;
  /** Modes a user may pick. */
  modes: readonly EmailMode[];
  /** Whether a per-matter email mute suppresses this category. */
  honoursMute: boolean;
};

/** Display order for the settings page and the digest email. */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategoryMeta[] = [
  {
    key: "deadlines",
    label: "Deadlines",
    description:
      "Reminders 7 days, 1 day and on the day a deadline is due, and when it is overdue.",
    modes: ["instant", "digest"],
    honoursMute: false,
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "Tasks assigned to you, and tasks coming due.",
    modes: ALL_MODES,
    honoursMute: true,
  },
  {
    key: "settlement",
    label: "Settlement approvals",
    description: "Settlement approval steps approved or rejected.",
    modes: ALL_MODES,
    honoursMute: true,
  },
  {
    key: "billing",
    label: "Billing",
    description: "Payments recorded on your matters' invoices.",
    modes: ALL_MODES,
    honoursMute: true,
  },
  {
    key: "matter_team",
    label: "Matter team",
    description: "You were added to a matter's team.",
    modes: ALL_MODES,
    honoursMute: true,
  },
  {
    key: "portal",
    label: "Client portal",
    description: "Client messages and uploads in the client portal.",
    modes: ALL_MODES,
    honoursMute: true,
  },
  {
    key: "other",
    label: "Other",
    description: "Mentions and anything else.",
    modes: ALL_MODES,
    honoursMute: true,
  },
];

export const CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> = {
  deadline_approaching: "deadlines",
  deadline_overdue: "deadlines",
  task_assigned: "tasks",
  task_due_soon: "tasks",
  settlement_step_approved: "settlement",
  settlement_step_rejected: "settlement",
  invoice_payment_recorded: "billing",
  matter_assigned: "matter_team",
  portal_upload: "portal",
  portal_message: "portal",
  note_mentioned: "other",
  transcript_ready: "other",
  transcript_failed: "other",
  generic: "other",
};

const META_BY_KEY = new Map(NOTIFICATION_CATEGORIES.map((c) => [c.key, c]));

export function categoryMeta(category: NotificationCategory): NotificationCategoryMeta {
  return META_BY_KEY.get(category)!;
}

export function isNotificationCategory(value: string): value is NotificationCategory {
  return META_BY_KEY.has(value as NotificationCategory);
}

/** Category for a stored type string; unknown → "other". */
export function categoryOf(type: string): NotificationCategory {
  return Object.hasOwn(CATEGORY_BY_TYPE, type)
    ? CATEGORY_BY_TYPE[type as NotificationType]
    : "other";
}

export function isAllowedMode(category: NotificationCategory, mode: string): mode is EmailMode {
  return categoryMeta(category).modes.includes(mode as EmailMode);
}

/** The mode in force: the stored one when allowed, else "instant". */
export function effectiveMode(
  category: NotificationCategory,
  stored: string | undefined,
): EmailMode {
  return stored !== undefined && isAllowedMode(category, stored) ? stored : "instant";
}
