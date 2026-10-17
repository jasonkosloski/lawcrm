/**
 * getEditableEventIds — the UI's per-event edit gate must agree with
 * the canEditEvent resolver the actions enforce (creator bypass;
 * events.edit for matter events; events.edit_non_matter for the rest),
 * not with the blanket events.edit key.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { findMany, hasPermission } = vi.hoisted(() => ({
  findMany: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { calendarEvent: { findMany } },
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "me"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: hasPermission,
}));

vi.mock("@/lib/matter-access", () => ({
  filterAccessibleMatterIds: vi.fn(
    async (_u: string, ids: string[]) => new Set(ids.filter((i) => i !== "walled"))
  ),
}));

import { getEditableEventIds } from "./calendar-edit-flags";

const grant = (...keys: string[]) =>
  hasPermission.mockImplementation(async (k: string) => keys.includes(k));

const base = {
  visibility: "default",
  createdBy: { defaultEventVisibility: "default" },
  attendees: [],
  matter: null,
};
const rows = [
  { id: "mine-personal", createdById: "me", matterId: null },
  { id: "mine-matter", createdById: "me", matterId: "m1" },
  { id: "theirs-personal", createdById: "other", matterId: null },
  { id: "theirs-matter", createdById: "other", matterId: "m1" },
].map((r) => ({
  ...base,
  ...r,
  matter: r.matterId ? { teamMembers: [{ userId: "me" }] } : null,
}));

beforeEach(() => {
  findMany.mockReset();
  hasPermission.mockReset();
  findMany.mockResolvedValue(rows);
});

describe("getEditableEventIds", () => {
  test("a creator without events.edit can still edit their OWN events", async () => {
    grant();
    const ids = await getEditableEventIds(rows.map((r) => r.id));
    expect([...ids].sort()).toEqual(["mine-matter", "mine-personal"]);
  });

  test("events.edit alone covers matter events, not others' personal events", async () => {
    grant("events.edit");
    const ids = await getEditableEventIds(rows.map((r) => r.id));
    expect([...ids].sort()).toEqual([
      "mine-matter",
      "mine-personal",
      "theirs-matter",
    ]);
  });

  test("events.edit_non_matter alone covers non-matter events only", async () => {
    grant("events.edit_non_matter");
    const ids = await getEditableEventIds(rows.map((r) => r.id));
    expect([...ids].sort()).toEqual([
      "mine-matter",
      "mine-personal",
      "theirs-personal",
    ]);
  });

  test("holding both keys allows every non-private, non-walled event", async () => {
    grant("events.edit", "events.edit_non_matter");
    const ids = await getEditableEventIds(rows.map((r) => r.id));
    expect(ids.size).toBe(4);
  });

  test("no ids, no work", async () => {
    grant();
    expect((await getEditableEventIds([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  test("ids that no longer exist are simply not editable", async () => {
    grant();
    findMany.mockResolvedValue([]);
    expect((await getEditableEventIds(["gone"])).size).toBe(0);
  });
});

describe("getEditableEventIds - private events and the matter wall", () => {
  test("someone else's private event and a walled matter's event get no edit even with every key", async () => {
    grant("events.edit", "events.edit_non_matter");
    findMany.mockResolvedValue([
      { ...base, id: "private", createdById: "other", matterId: null, visibility: "private" },
      {
        ...base,
        id: "walled",
        createdById: "other",
        matterId: "walled",
        matter: { teamMembers: [] },
      },
      { ...base, id: "plain", createdById: "other", matterId: null },
      { ...base, id: "own-private", createdById: "me", matterId: null, visibility: "private" },
    ]);
    const ids = await getEditableEventIds([
      "private",
      "walled",
      "plain",
      "own-private",
    ]);
    expect([...ids].sort()).toEqual(["own-private", "plain"]);
  });
});
