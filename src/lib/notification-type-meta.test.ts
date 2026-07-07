/**
 * Tests for the shared notification type → icon/tone meta.
 *
 * The record itself is compile-time-complete (keyed by the
 * NotificationType union), so the runtime surface worth testing is
 * the string-keyed lookup the UI actually uses: known DB values
 * resolve to their meta, unknown / legacy values fall back to
 * generic instead of crashing a render.
 */

import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_TYPE_META,
  notificationTypeMeta,
} from "@/lib/notification-type-meta";

describe("notificationTypeMeta", () => {
  test("resolves a known type to its meta", () => {
    expect(notificationTypeMeta("task_assigned")).toBe(
      NOTIFICATION_TYPE_META.task_assigned
    );
    expect(notificationTypeMeta("deadline_overdue")).toBe(
      NOTIFICATION_TYPE_META.deadline_overdue
    );
  });

  test("unknown / legacy type strings fall back to generic", () => {
    expect(notificationTypeMeta("not_a_real_type")).toBe(
      NOTIFICATION_TYPE_META.generic
    );
    expect(notificationTypeMeta("")).toBe(NOTIFICATION_TYPE_META.generic);
  });

  test("every meta entry carries an icon component and a tone class", () => {
    for (const [type, meta] of Object.entries(NOTIFICATION_TYPE_META)) {
      expect(meta.icon, `icon for ${type}`).toBeTruthy();
      expect(meta.tone, `tone for ${type}`).toMatch(/^text-/);
    }
  });
});
