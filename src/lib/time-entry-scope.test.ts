/**
 * Unit tests for the TimeEntry exactly-one-of-(matterId, leadId)
 * scope assertion. Pure function — no DB.
 */

import { describe, expect, test } from "vitest";
import { assertTimeEntryScope } from "@/lib/time-entry-scope";

describe("assertTimeEntryScope", () => {
  test("matter-only scope passes and normalizes leadId to null", () => {
    expect(
      assertTimeEntryScope({ matterId: "m1", leadId: undefined })
    ).toEqual({ matterId: "m1", leadId: null });
  });

  test("lead-only scope passes and normalizes matterId to null", () => {
    expect(assertTimeEntryScope({ matterId: null, leadId: "l1" })).toEqual({
      matterId: null,
      leadId: "l1",
    });
  });

  test("both set throws", () => {
    expect(() =>
      assertTimeEntryScope({ matterId: "m1", leadId: "l1" })
    ).toThrow(/both/);
  });

  test("neither set throws", () => {
    expect(() =>
      assertTimeEntryScope({ matterId: null, leadId: null })
    ).toThrow(/neither/);
  });

  test("empty strings count as unset (a crafted form post can't smuggle an unscoped row)", () => {
    expect(() => assertTimeEntryScope({ matterId: "", leadId: "" })).toThrow(
      /neither/
    );
    expect(assertTimeEntryScope({ matterId: "", leadId: "l1" })).toEqual({
      matterId: null,
      leadId: "l1",
    });
  });
});
