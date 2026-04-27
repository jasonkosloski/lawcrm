/**
 * Tests for the permission catalog.
 *
 * The catalog drives the matrix UI, the `requirePermission(...)`
 * gate, and the activity-log titles for grant/revoke actions.
 * Three invariants worth pinning down:
 *   1. Every key is unique (no collisions).
 *   2. Every key follows the dotted naming convention.
 *   3. `permissionLabel` round-trips known keys to their label
 *      and falls through to the raw key for unknown ones.
 */

import { describe, expect, test } from "vitest";
import {
  isKnownPermission,
  permissionLabel,
  PERMISSION_CATEGORIES,
  PERMISSION_KEYS,
  PERMISSION_KEYS_SET,
} from "./permissions";

describe("PERMISSION_KEYS — catalog shape", () => {
  test("non-empty", () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThan(0);
  });

  test("every key is unique", () => {
    expect(PERMISSION_KEYS.length).toBe(PERMISSION_KEYS_SET.size);
  });

  test("every key uses the dotted prefix.action convention", () => {
    for (const key of PERMISSION_KEYS) {
      // Two-or-more dotted segments, lowercase snake_case parts.
      // First segment allows underscores too (e.g. `time_entries`).
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  test("every key's prefix matches a category id", () => {
    const categoryIds = new Set(PERMISSION_CATEGORIES.map((c) => c.id));
    for (const key of PERMISSION_KEYS) {
      const prefix = key.split(".")[0];
      expect(categoryIds.has(prefix)).toBe(true);
    }
  });

  test("every category has at least one permission", () => {
    for (const cat of PERMISSION_CATEGORIES) {
      expect(cat.permissions.length).toBeGreaterThan(0);
    }
  });

  test("PERMISSION_KEYS_SET is the flat set of catalog keys", () => {
    const flat = PERMISSION_CATEGORIES.flatMap((c) =>
      c.permissions.map((p) => p.key)
    );
    expect(new Set(flat)).toEqual(PERMISSION_KEYS_SET);
  });
});

describe("isKnownPermission", () => {
  test("returns true for catalog entries", () => {
    // Pick a stable, structurally-required key.
    expect(isKnownPermission("matters.manage_team")).toBe(true);
  });

  test("returns false for typos / removed keys", () => {
    expect(isKnownPermission("matters.manage_teem")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
    expect(isKnownPermission("not.a.real.key")).toBe(false);
  });
});

describe("permissionLabel", () => {
  test("known keys return their human label", () => {
    expect(permissionLabel("matters.manage_team")).toBe(
      "Manage team members"
    );
  });

  test("unknown keys fall through to the raw key", () => {
    // Lets old RolePermission rows pinned to a removed catalog
    // entry render readably (with the cite still being the raw
    // key) instead of showing as undefined.
    expect(permissionLabel("not.a.real.key")).toBe("not.a.real.key");
  });
});

describe("expected-key invariants", () => {
  // These keys are referenced by name in production code paths
  // (server actions + page guards). If the catalog drops them
  // without those callsites being updated first, the gate
  // silently no-ops or redirects unexpectedly. These tests are
  // the early-warning system.
  test.each([
    "matters.create",
    "matters.manage_team",
    "matters.expense.create",
    "matters.expense.delete",
    "billing.send_invoice",
    "billing.record_payment",
    "billing.apply_trust",
    "billing.delete_draft",
    "trust.record_transaction",
    "firm.manage_roles",
    "firm.manage_permissions",
    "firm.edit_info",
    "firm.manage_practice_areas",
    "firm.view_activity",
    "firm.manage_team_directory",
    "documents.delete_any",
    "intake.conflict_check.run",
    "intake.conflict_check.override",
    "matters.settlement.view",
    "matters.settlement.edit",
    "matters.settlement.manage_liens",
    "matters.settlement.approve",
    "tasks.create",
    "tasks.edit",
    "tasks.delete",
    "deadlines.create",
    "deadlines.edit",
    "deadlines.delete",
    "notes.create",
    "notes.edit_any",
    "notes.delete_any",
    "notes.pin",
    "time_entries.create",
    "time_entries.edit_any",
    "time_entries.delete_any",
    "parties.create",
    "parties.edit",
    "parties.delete",
    "events.create",
    "events.edit",
    "events.delete",
  ])("%s exists in the catalog", (key) => {
    expect(isKnownPermission(key)).toBe(true);
  });
});
