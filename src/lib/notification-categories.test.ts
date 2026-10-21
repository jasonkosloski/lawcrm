import { describe, expect, test } from "vitest";
import type { NotificationType } from "@/lib/notifications";
import {
  CATEGORY_BY_TYPE,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  effectiveMode,
  isAllowedMode,
} from "@/lib/notification-categories";

describe("notification categories", () => {
  test("maps every type", () => {
    const expected: Record<NotificationType, string> = {
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
      generic: "other",
    };
    expect(CATEGORY_BY_TYPE).toEqual(expected);
  });

  test("lists categories in display order with labels", () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => [c.key, c.label])).toEqual([
      ["deadlines", "Deadlines"],
      ["tasks", "Tasks"],
      ["settlement", "Settlement approvals"],
      ["billing", "Billing"],
      ["matter_team", "Matter team"],
      ["portal", "Client portal"],
      ["other", "Other"],
    ]);
  });

  test("unknown type is other", () => {
    expect(categoryOf("something_new")).toBe("other");
    expect(categoryOf("task_assigned")).toBe("tasks");
  });

  test("deadlines disallow off", () => {
    expect(isAllowedMode("deadlines", "off")).toBe(false);
    expect(isAllowedMode("deadlines", "digest")).toBe(true);
    expect(isAllowedMode("tasks", "off")).toBe(true);
    expect(isAllowedMode("tasks", "weekly")).toBe(false);
  });

  test("effectiveMode coerces", () => {
    expect(effectiveMode("deadlines", "off")).toBe("instant");
    expect(effectiveMode("tasks", undefined)).toBe("instant");
    expect(effectiveMode("tasks", "digest")).toBe("digest");
    expect(effectiveMode("tasks", "bogus")).toBe("instant");
  });
});
