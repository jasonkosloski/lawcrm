/**
 * Tests for expense category constants. Lightweight — these
 * exist mostly to prevent accidental key/label drift between
 * the schema docstring + the form picker + the row label.
 */

import { describe, expect, test } from "vitest";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  expenseInitialState,
} from "./expense-constants";

describe("EXPENSE_CATEGORIES", () => {
  test("non-empty + every value is a string slug", () => {
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThan(0);
    for (const c of EXPENSE_CATEGORIES) {
      expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test("every category has a label", () => {
    for (const c of EXPENSE_CATEGORIES) {
      const label = EXPENSE_CATEGORY_LABEL[c];
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    }
  });

  test("'other' is in the catalog (the fallback bucket)", () => {
    expect(EXPENSE_CATEGORIES).toContain("other");
  });
});

describe("expenseInitialState", () => {
  test("starts idle with no errors", () => {
    expect(expenseInitialState).toEqual({ status: "idle" });
  });
});
