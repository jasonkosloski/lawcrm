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
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

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
    expect(log).toMatchObject({ matterId: null, type: "settings", source: "Settings" });
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
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: b.venue.id } })).name).toBe(
      "Denver",
    );
  });
});

describe("deleteVenue / setVenueActive", () => {
  test("refused when a matter references the venue, succeeds otherwise", async () => {
    const c = await createVenue(aurora);
    if (!c.ok) throw new Error("setup");
    const { areaId, stageId } = await seedPracticeArea();
    const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: c.venue.id } });
    const blocked = await deleteVenue(c.venue.id);
    expect(blocked).toEqual({ ok: false, error: "A matter uses this venue. Archive it instead." });
    expect(requirePermission).toHaveBeenCalledWith("venues.delete");
    expect(await prisma.venue.count()).toBe(1);
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: null } });
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

describe("venue court format and caption name", () => {
  const mkFormat = (name: string, isActive = true) =>
    prisma.courtFormat.create({ data: { name, isActive } });

  test("create saves format and trimmed caption name", async () => {
    const f = await mkFormat("CO District");
    const res = await createVenue({
      ...aurora,
      courtFormatId: f.id,
      captionName: "  Arapahoe County District Court ",
    });
    expect(res.ok).toBe(true);
    const row = await prisma.venue.findFirstOrThrow();
    expect(row).toMatchObject({
      courtFormatId: f.id,
      captionName: "Arapahoe County District Court",
    });
  });

  test("blank caption becomes null, over 300 refused, unknown format refused", async () => {
    await createVenue({ ...aurora, captionName: "   " });
    expect((await prisma.venue.findFirstOrThrow()).captionName).toBeNull();
    const long = await createVenue({ name: "X", state: "CO", captionName: "x".repeat(301) });
    expect(long).toMatchObject({ ok: false, code: "invalid" });
    const bad = await createVenue({ name: "Y", state: "CO", courtFormatId: "nope" });
    expect(bad).toMatchObject({ ok: false, code: "invalid" });
    expect(await prisma.venue.count()).toBe(1);
  });

  test("archived format accepted only when already the venue's format", async () => {
    const archived = await mkFormat("Old", false);
    const res = await createVenue({ ...aurora, courtFormatId: archived.id });
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    const v = await prisma.venue.create({
      data: { name: "Aurora", nameKey: "aurora", state: "CO", courtFormatId: archived.id },
    });
    const keep = await updateVenue(v.id, { ...aurora, courtFormatId: archived.id });
    expect(keep.ok).toBe(true);
    const other = await prisma.venue.create({
      data: { name: "Other", nameKey: "other", state: "CO" },
    });
    const refused = await updateVenue(other.id, {
      name: "Other",
      state: "CO",
      courtFormatId: archived.id,
    });
    expect(refused).toMatchObject({ ok: false, code: "invalid" });
  });

  test("update can clear the format", async () => {
    const f = await mkFormat("CO District");
    const v = await prisma.venue.create({
      data: {
        name: "Aurora",
        nameKey: "aurora",
        state: "CO",
        courtFormatId: f.id,
        captionName: "A",
      },
    });
    await updateVenue(v.id, { ...aurora, courtFormatId: null, captionName: null });
    expect(await prisma.venue.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
      courtFormatId: null,
      captionName: null,
    });
  });
});

describe("foreign-key races on courtFormatId", () => {
  const fk = () => Object.assign(new Error("fk"), { code: "P2003" });
  const gone = {
    ok: false,
    code: "invalid",
    errors: { courtFormatId: ["That court format no longer exists — reload."] },
  };

  test("create and update return the friendly invalid shape", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "F" } });
    const create = vi.spyOn(prisma.venue, "create").mockRejectedValueOnce(fk());
    expect(await createVenue({ ...aurora, courtFormatId: f.id })).toEqual(gone);
    create.mockRestore();

    const v = await prisma.venue.create({
      data: { name: "Aurora", nameKey: "aurora", state: "CO" },
    });
    const update = vi.spyOn(prisma.venue, "update").mockRejectedValueOnce(fk());
    expect(await updateVenue(v.id, { ...aurora, courtFormatId: f.id })).toEqual(gone);
    update.mockRestore();
  });
});

describe("venue address", () => {
  const address = { addressLine1: " 1437 Bannock St ", addressLine2: "Room 256", zip: "80202" };

  test("saves trimmed, lists it, and leaves it alone when the input omits it", async () => {
    const res = await createVenue({ ...aurora, ...address });
    if (!res.ok) throw new Error("create failed");
    expect(await prisma.venue.findUniqueOrThrow({ where: { id: res.venue.id } })).toMatchObject({
      addressLine1: "1437 Bannock St",
      addressLine2: "Room 256",
      zip: "80202",
    });
    const [listed] = await listVenues({ activeOnly: true, withAddress: true });
    expect(listed).toMatchObject({ addressLine1: "1437 Bannock St", zip: "80202" });

    await updateVenue(res.venue.id, { ...aurora, county: "Adams" });
    expect(await prisma.venue.findUniqueOrThrow({ where: { id: res.venue.id } })).toMatchObject({
      county: "Adams",
      addressLine1: "1437 Bannock St",
    });
  });

  test("empty strings clear it", async () => {
    const res = await createVenue({ ...aurora, ...address });
    if (!res.ok) throw new Error("create failed");
    await updateVenue(res.venue.id, { ...aurora, addressLine1: "", addressLine2: " ", zip: "" });
    expect(await prisma.venue.findUniqueOrThrow({ where: { id: res.venue.id } })).toMatchObject({
      addressLine1: null,
      addressLine2: null,
      zip: null,
    });
  });

  test("rejects lines that are too long", async () => {
    const res = await createVenue({
      ...aurora,
      addressLine1: "x".repeat(121),
      zip: "1".repeat(21),
    });
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (!res.ok && res.code === "invalid") {
      expect(Object.keys(res.errors).sort()).toEqual(["addressLine1", "zip"]);
    }
  });
});

test("listVenues leaves the address out unless asked", async () => {
  await createVenue({ ...aurora, addressLine1: "1 Main St" });
  const [row] = await listVenues({ activeOnly: true });
  expect(row).not.toHaveProperty("addressLine1");
});
