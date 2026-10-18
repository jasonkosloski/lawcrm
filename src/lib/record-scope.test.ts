import { describe, expect, test } from "vitest";
import { optionalScopeOf, scopePaths } from "./record-scope";

describe("optionalScopeOf", () => {
  test("matter, lead, and neither (firm-wide / personal)", () => {
    expect(optionalScopeOf({ matterId: "m1", leadId: null })).toEqual({
      kind: "matter",
      matterId: "m1",
    });
    expect(optionalScopeOf({ matterId: null, leadId: "l1" })).toEqual({
      kind: "lead",
      leadId: "l1",
    });
    expect(optionalScopeOf({ matterId: null, leadId: null })).toBeNull();
  });

  test("both set throws", () => {
    expect(() => optionalScopeOf({ matterId: "m1", leadId: "l1" })).toThrow(
      /both set/
    );
  });
});

describe("scopePaths", () => {
  test("the record's tab and overview, nothing for no scope", () => {
    expect(scopePaths({ kind: "matter", matterId: "m1" }, "tasks")).toEqual([
      "/matters/m1/tasks",
      "/matters/m1",
    ]);
    expect(scopePaths({ kind: "lead", leadId: "l1" }, "events")).toEqual([
      "/intake/l1/events",
      "/intake/l1",
    ]);
    expect(scopePaths(null, "tasks")).toEqual([]);
  });
});
