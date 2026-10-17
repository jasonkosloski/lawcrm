/**
 * Integration tests for `setMatterPin` (the idempotent primitive the UI
 * uses) and its `toggleMatterPin` wrapper.
 *
 * The action is small but the contract matters — pins drive the
 * sidebar's "Pinned matters" list, so a regression here would
 * silently flip the wrong row or fail to flip at all. We verify:
 *
 *   - first call creates a UserMatterPin row + returns
 *     `{ pinned: true }`.
 *   - second call deletes the row + returns `{ pinned: false }`.
 *   - pins are scoped per (user, matter) — pinning user A's
 *     matter doesn't affect user B's pins.
 *   - third call (after un-pin) re-creates the row cleanly.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { setMatterPin, toggleMatterPin } from "@/app/actions/matter-pins";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRevalidate = vi.mocked(revalidatePath);

let userId: string;
let otherUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "primary@example.com" });
  userId = u.userId;
  const u2 = await seedUser({ firmId, email: "other@example.com" });
  otherUserId = u2.userId;
  mockedGetUser.mockResolvedValue(userId);

  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("toggleMatterPin", () => {
  test("first call pins + revalidates the layout tree", async () => {
    const res = await toggleMatterPin(matterId);
    expect(res.pinned).toBe(true);

    const row = await prisma.userMatterPin.findUnique({
      where: { userId_matterId: { userId, matterId } },
    });
    expect(row).not.toBeNull();
    // The sidebar lives in the layout — revalidate must cover it.
    expect(mockedRevalidate).toHaveBeenCalledWith("/", "layout");
  });

  test("second call un-pins (idempotent toggle)", async () => {
    await toggleMatterPin(matterId);
    const res = await toggleMatterPin(matterId);
    expect(res.pinned).toBe(false);

    const row = await prisma.userMatterPin.findUnique({
      where: { userId_matterId: { userId, matterId } },
    });
    expect(row).toBeNull();
  });

  test("third call re-pins after un-pin", async () => {
    await toggleMatterPin(matterId); // pin
    await toggleMatterPin(matterId); // unpin
    const res = await toggleMatterPin(matterId); // pin again
    expect(res.pinned).toBe(true);

    const count = await prisma.userMatterPin.count({
      where: { userId, matterId },
    });
    expect(count).toBe(1);
  });

  test("pins are scoped per user — toggling for A doesn't affect B", async () => {
    // User A pins.
    await toggleMatterPin(matterId);

    // Switch to user B and toggle the same matter — they should
    // get their OWN pin, not interfere with user A's.
    mockedGetUser.mockResolvedValue(otherUserId);
    const res = await toggleMatterPin(matterId);
    expect(res.pinned).toBe(true);

    // Both rows exist, scoped per-user.
    const aPin = await prisma.userMatterPin.findUnique({
      where: { userId_matterId: { userId, matterId } },
    });
    const bPin = await prisma.userMatterPin.findUnique({
      where: { userId_matterId: { userId: otherUserId, matterId } },
    });
    expect(aPin).not.toBeNull();
    expect(bPin).not.toBeNull();
  });
});

describe("setMatterPin", () => {
  test("states the wanted value: pin twice stays pinned, unpin twice stays unpinned", async () => {
    expect(await setMatterPin(matterId, true)).toEqual({ ok: true, pinned: true });
    // A stale tab sending "pin" again must NOT flip it off.
    expect(await setMatterPin(matterId, true)).toEqual({ ok: true, pinned: true });
    expect(await prisma.userMatterPin.count({ where: { userId, matterId } })).toBe(1);

    expect(await setMatterPin(matterId, false)).toEqual({ ok: true, pinned: false });
    expect(await setMatterPin(matterId, false)).toEqual({ ok: true, pinned: false });
    expect(await prisma.userMatterPin.count({ where: { userId, matterId } })).toBe(0);
    expect(mockedRevalidate).toHaveBeenCalledWith("/", "layout");
  });

  test("concurrent pin calls don't throw a unique violation", async () => {
    const results = await Promise.all([
      setMatterPin(matterId, true),
      setMatterPin(matterId, true),
      setMatterPin(matterId, true),
    ]);
    expect(results.every((r) => r.ok && r.pinned)).toBe(true);
    expect(await prisma.userMatterPin.count({ where: { userId, matterId } })).toBe(1);
  });

  test("pinning an unknown matter is an error result, not an FK 500", async () => {
    const res = await setMatterPin("no-such-matter", true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(await prisma.userMatterPin.count()).toBe(0);
  });

  test("unpinning something never pinned (or unknown) is a harmless no-op", async () => {
    expect((await setMatterPin("no-such-matter", false)).ok).toBe(true);
    expect((await setMatterPin(matterId, false)).ok).toBe(true);
  });

  test("scoped to the caller: unpinning for A leaves B's pin", async () => {
    await setMatterPin(matterId, true);
    mockedGetUser.mockResolvedValue(otherUserId);
    await setMatterPin(matterId, true);
    await setMatterPin(matterId, false);
    expect(await prisma.userMatterPin.count({ where: { userId } })).toBe(1);
    expect(await prisma.userMatterPin.count({ where: { userId: otherUserId } })).toBe(0);
  });
});
