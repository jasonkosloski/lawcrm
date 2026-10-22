/**
 * Integration tests for `setMatterPin` — the idempotent pin writer the
 * header PinToggle uses (F783). Unlike the blind `toggleMatterPin`, it
 * takes the TARGET state, so a stale view can't invert the intent and
 * concurrent calls converge instead of one throwing P2002.
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

let userId: string;
let otherUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId, email: "primary@example.com" })).userId;
  otherUserId = (await seedUser({ firmId, email: "other@example.com" })).userId;
  mockedGetUser.mockResolvedValue(userId);
  const area = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    })
  ).matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

const pinCount = (uid = userId) => prisma.userMatterPin.count({ where: { userId: uid, matterId } });

describe("setMatterPin", () => {
  test("pins, and revalidates the layout tree", async () => {
    expect(await setMatterPin(matterId, true)).toEqual({
      ok: true,
      pinned: true,
    });
    expect(await pinCount()).toBe(1);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/", "layout");
  });

  test("pinning an already-pinned matter keeps it pinned (a toggle would unpin)", async () => {
    await toggleMatterPin(matterId); // pinned in "another tab"
    const res = await setMatterPin(matterId, true); // stale tab clicks Pin
    expect(res).toEqual({ ok: true, pinned: true });
    expect(await pinCount()).toBe(1);
  });

  test("unpinning a matter that is not pinned is a no-op, not an error", async () => {
    expect(await setMatterPin(matterId, false)).toEqual({
      ok: true,
      pinned: false,
    });
    expect(await pinCount()).toBe(0);
  });

  test("unpins an existing pin", async () => {
    await setMatterPin(matterId, true);
    await setMatterPin(matterId, false);
    expect(await pinCount()).toBe(0);
  });

  test("concurrent pins converge on one row without throwing", async () => {
    const results = await Promise.all([
      setMatterPin(matterId, true),
      setMatterPin(matterId, true),
      setMatterPin(matterId, true),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await pinCount()).toBe(1);
  });

  test("is scoped to the current user", async () => {
    await setMatterPin(matterId, true);
    mockedGetUser.mockResolvedValue(otherUserId);
    await setMatterPin(matterId, false); // other user's unpin
    expect(await pinCount(userId)).toBe(1);
  });

  test("an unknown matter is not found (matter wall: unknown == hidden)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(setMatterPin("00000000-0000-0000-0000-000000000000", true)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/,
    );
    spy.mockRestore();
  });
});
