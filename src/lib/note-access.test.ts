import { describe, expect, test, vi } from "vitest";

const getPerms = vi.fn();
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u1"),
}));
vi.mock("@/lib/permission-check", () => ({
  getCurrentUserPermissions: () => getPerms(),
}));

import { getNoteAccess } from "./note-access";

const flags = (a: Record<string, unknown>) =>
  Object.entries(a)
    .filter(([k]) => k !== "userId")
    .map(([, v]) => v);

describe("getNoteAccess", () => {
  test("admins get everything", async () => {
    getPerms.mockResolvedValue({ isAdmin: true, granted: new Set() });
    const a = await getNoteAccess();
    expect(a.userId).toBe("u1");
    expect(flags(a).every((v) => v === true)).toBe(true);
  });

  test("a role with no permissions gets nothing", async () => {
    getPerms.mockResolvedValue({ isAdmin: false, granted: new Set() });
    const a = await getNoteAccess();
    expect(flags(a).every((v) => v === false)).toBe(true);
  });

  test("maps each permission key to its own flag", async () => {
    getPerms.mockResolvedValue({
      isAdmin: false,
      granted: new Set([
        "notes.create",
        "notes.pin",
        "time_entries.delete_any",
        "deadlines.create",
      ]),
    });
    const a = await getNoteAccess();
    expect(a).toMatchObject({
      canCreateNote: true,
      canPin: true,
      canDeleteAnyTime: true,
      canCreateDeadline: true,
      canDeleteAnyNote: false,
      canCreateTask: false,
      canDeleteTask: false,
      canDeleteDeadline: false,
      canCreateTime: false,
      canCreateEvent: false,
    });
  });
});
