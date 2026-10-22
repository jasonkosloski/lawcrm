import { describe, expect, test } from "vitest";
import { CAPTURE_CREATE_PERMISSION, requiredCapturePermissions } from "@/lib/capture-permissions";
import { isKnownPermission } from "@/lib/permissions";
import type { ValidCapture } from "@/lib/capture-schemas";

const task = {
  kind: "task",
  tempId: "a",
  title: "T",
  dueDate: "",
  priority: "normal",
} as ValidCapture;
const time = {
  kind: "time",
  tempId: "b",
  date: "2026-01-01",
  hours: "1",
  activity: "x",
  narrative: "",
} as ValidCapture;
const note = (isPinned: boolean) =>
  ({ kind: "note_sibling", tempId: "c", content: "n", type: "note", isPinned }) as ValidCapture;

describe("CAPTURE_CREATE_PERMISSION", () => {
  test("every mapped key exists in the permission catalog", () => {
    for (const key of Object.values(CAPTURE_CREATE_PERMISSION)) {
      expect(isKnownPermission(key)).toBe(true);
    }
  });
  test("notes.pin exists in the catalog", () => {
    expect(isKnownPermission("notes.pin")).toBe(true);
  });
});

describe("requiredCapturePermissions", () => {
  test("no captures -> no keys", () => {
    expect(requiredCapturePermissions([])).toEqual([]);
  });

  test("distinct union of the kinds present", () => {
    expect(new Set(requiredCapturePermissions([task, task, time]))).toEqual(
      new Set(["tasks.create", "time_entries.create"]),
    );
  });

  test("a sibling note needs notes.create; pinned adds notes.pin", () => {
    expect(requiredCapturePermissions([note(false)])).toEqual(["notes.create"]);
    expect(new Set(requiredCapturePermissions([note(true)]))).toEqual(
      new Set(["notes.create", "notes.pin"]),
    );
  });

  test("ignoreKinds drops a kind entirely (bulk attach ignores note_sibling)", () => {
    expect(
      requiredCapturePermissions([note(true), task], {
        ignoreKinds: ["note_sibling"],
      }),
    ).toEqual(["tasks.create"]);
  });

  test("pinRequested adds notes.pin for a pinned primary note", () => {
    expect(requiredCapturePermissions([], { pinRequested: true })).toEqual(["notes.pin"]);
  });
});
