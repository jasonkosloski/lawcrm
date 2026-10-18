import { describe, expect, test } from "vitest";
import { notePathsToRevalidate, noteScopeOf, notesPathFor } from "./note-scope";

describe("noteScopeOf", () => {
  test("matter row", () => {
    expect(noteScopeOf({ matterId: "m1", leadId: null })).toEqual({
      kind: "matter",
      matterId: "m1",
    });
  });

  test("lead row", () => {
    expect(noteScopeOf({ matterId: null, leadId: "l1" })).toEqual({
      kind: "lead",
      leadId: "l1",
    });
  });

  test("both or neither set throws", () => {
    expect(() => noteScopeOf({ matterId: "m1", leadId: "l1" })).toThrow(
      /both set/
    );
    expect(() => noteScopeOf({ matterId: null, leadId: null })).toThrow(
      /neither/
    );
  });
});

describe("notesPathFor", () => {
  test("matter and lead tabs", () => {
    expect(notesPathFor({ kind: "matter", matterId: "m1" })).toBe(
      "/matters/m1/notes"
    );
    expect(notesPathFor({ kind: "lead", leadId: "l1" })).toBe(
      "/intake/l1/notes"
    );
  });
});

describe("notePathsToRevalidate", () => {
  test("matter note: tab + overview, plus events/calendar for a court note", () => {
    const scope = { kind: "matter", matterId: "m1" } as const;
    expect(notePathsToRevalidate(scope)).toEqual([
      "/matters/m1/notes",
      "/matters/m1",
    ]);
    expect(notePathsToRevalidate(scope, { calendarEventId: "e1" })).toEqual([
      "/matters/m1/notes",
      "/matters/m1",
      "/matters/m1/events",
      "/calendar",
    ]);
  });

  test("lead note: intake tab + lead overview", () => {
    expect(notePathsToRevalidate({ kind: "lead", leadId: "l1" })).toEqual([
      "/intake/l1/notes",
      "/intake/l1",
    ]);
  });
});
