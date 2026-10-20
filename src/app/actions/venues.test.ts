/**
 * Integration tests for the venue actions and list query.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(async () => "test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { createVenue, deleteVenue, setVenueActive, updateVenue } from "@/app/actions/venues";
import { listVenues } from "@/lib/queries/venues";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let userId: string;

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
  const firm = await seedFirm();
  userId = (await seedUser({ firmId: firm.firmId })).userId;
  vi.mocked(requirePermission).mockClear();
  vi.mocked(requirePermission).mockResolvedValue(userId);
});

const aurora = { name: "Aurora", city: "Aurora", county: "Arapahoe", state: "CO" };

describe("createVenue", () => {
  test("creates, gates on venues.add and logs", async () => {
    const res = await createVenue(aurora);
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("venues.add");
    const row = await prisma.venue.findFirstOrThrow();
    expect(row).toMatchObject({ name: "Aurora", nameKey: "aurora", state: "CO", isActive: true });
    const log = await prisma.activityLog.findFirst({ where: { title: 'Venue "Aurora" added' } });
    expect(log?.matterId).toBeNull();
  });

  test("duplicate name case-insensitively returns exists with the existing id", async () => {
    const first = await createVenue(aurora);
    const res = await createVenue({ name: " aurora ", state: "CO" });
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "exists" && first.ok) {
      expect(res.venue.id).toBe(first.venue.id);
    } else {
      throw new Error("expected exists");
    }
    expect(await prisma.venue.count()).toBe(1);
  });

  test("duplicate of an archived venue returns archived", async () => {
    const first = await createVenue(aurora);
    if (!first.ok) throw new Error("setup");
    await setVenueActive(first.venue.id, false);
    const res = await createVenue({ name: "AURORA", state: "CO" });
    expect(res).toMatchObject({ ok: false, code: "archived" });
    if (!res.ok && res.code === "archived") {
      expect(res.venue.id).toBe(first.venue.id);
      expect(res.venue.isActive).toBe(false);
    }
  });

  test("blank state is invalid", async () => {
    const res = await createVenue({ name: "X", state: "  " });
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (!res.ok && res.code === "invalid") expect(res.errors.state).toBeTruthy();
    expect(await prisma.venue.count()).toBe(0);
  });
});

describe("updateVenue", () => {
  test("gates on venues.edit and edits in place", async () => {
    const c = await createVenue(aurora);
    if (!c.ok) throw new Error("setup");
    vi.mocked(requirePermission).mockClear();
    const res = await updateVenue(c.venue.id, { ...aurora, county: "Adams" });
    expect(res.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("venues.edit");
    expect((await prisma.venue.findFirstOrThrow()).county).toBe("Adams");
  });

  test("renaming onto another venue returns exists", async () => {
    await createVenue(aurora);
    const b = await createVenue({ name: "Denver", state: "CO" });
    if (!b.ok) throw new Error("setup");
    const res = await updateVenue(b.venue.id, { name: "aurora", state: "CO" });
    expect(res).toMatchObject({ ok: false, code: "exists" });
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: b.venue.id } })).name).toBe("Denver");
  });
});

describe("deleteVenue / setVenueActive", () => {
  test("refused when a matter references the venue, succeeds otherwise", async () => {
    const c = await createVenue(aurora);
    if (!c.ok) throw new Error("setup");
    const spy = vi.spyOn(prisma.matter, "count").mockResolvedValueOnce(1);
    const blocked = await deleteVenue(c.venue.id);
    spy.mockRestore();
    expect(blocked).toEqual({ ok: false, error: "A matter uses this venue. Archive it instead." });
    expect(requirePermission).toHaveBeenCalledWith("venues.delete");
    expect(await prisma.venue.count()).toBe(1);
    expect(await deleteVenue(c.venue.id)).toEqual({ ok: true });
    expect(await prisma.venue.count()).toBe(0);
  });

  test("setVenueActive(false) hides it from the active-only list", async () => {
    const c = await createVenue(aurora);
    if (!c.ok) throw new Error("setup");
    await setVenueActive(c.venue.id, false);
    expect(await listVenues({ activeOnly: true })).toEqual([]);
    const all = await listVenues({ activeOnly: false });
    expect(all).toHaveLength(1);
    expect(all[0].matterCount).toBe(0);
  });
});
