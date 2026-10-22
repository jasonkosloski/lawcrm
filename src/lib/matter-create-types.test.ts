import { describe, expect, it } from "vitest";
import { MATTER_CREATE_ENTRIES, MATTER_CREATE_PERMISSION } from "@/lib/matter-create-types";
import { isKnownPermission } from "@/lib/permissions";

describe("MATTER_CREATE_PERMISSION", () => {
  it("maps every Create-menu entry to a real permission key", () => {
    for (const entry of MATTER_CREATE_ENTRIES) {
      const key = MATTER_CREATE_PERMISSION[entry.type];
      expect(key, `no permission for ${entry.type}`).toBeTruthy();
      expect(isKnownPermission(key), `${key} is not a registered key`).toBe(true);
    }
  });

  it("uses the keys the create actions enforce", () => {
    expect(MATTER_CREATE_PERMISSION.note).toBe("notes.create");
    expect(MATTER_CREATE_PERMISSION.event).toBe("events.create");
    expect(MATTER_CREATE_PERMISSION.time).toBe("time_entries.create");
  });
});
