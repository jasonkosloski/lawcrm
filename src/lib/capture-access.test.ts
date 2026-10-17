import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/permission-check", () => ({
  getCurrentUserPermissions: vi.fn(),
}));

import { resolveCaptureAccess } from "./capture-access";

describe("resolveCaptureAccess", () => {
  test("an admin may add every sibling kind and pin", () => {
    const a = resolveCaptureAccess(true, new Set());
    expect(a.kinds.sort()).toEqual(
      ["deadline", "event", "note_sibling", "task", "time"].sort()
    );
    expect(a.canPin).toBe(true);
  });

  test("a viewer with only tasks.create can add tasks and nothing else", () => {
    const a = resolveCaptureAccess(false, new Set(["tasks.create"]));
    expect(a.kinds).toEqual(["task"]);
    expect(a.canPin).toBe(false);
  });

  test("each kind follows its own create key; pinning needs notes.pin", () => {
    const a = resolveCaptureAccess(
      false,
      new Set(["time_entries.create", "notes.create", "events.create"])
    );
    expect(a.kinds.sort()).toEqual(["event", "note_sibling", "time"]);
    expect(a.canPin).toBe(false);
    expect(
      resolveCaptureAccess(false, new Set(["notes.create", "notes.pin"])).canPin
    ).toBe(true);
  });
});
