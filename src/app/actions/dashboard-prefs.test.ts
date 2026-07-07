/**
 * Integration tests for the dashboard-prefs actions.
 *
 * The blob on `User.dashboardPrefs` is rewritten wholesale on every
 * change, so the contract worth pinning is that the two actions never
 * clobber each other's half:
 *
 *   - `setDashboardCardVisible` preserves a previously saved order.
 *   - `setDashboardCardOrder` preserves previously saved visibility.
 *
 * Plus the server-side sanitization: arbitrary client arrays go
 * through `mergeOrder`, so what lands in the DB is always a full
 * permutation of the known card keys.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  setDashboardCardOrder,
  setDashboardCardVisible,
} from "@/app/actions/dashboard-prefs";
import { DASHBOARD_CARD_KEYS } from "@/lib/dashboard-prefs";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRevalidate = vi.mocked(revalidatePath);

let userId: string;

/** Read the raw stored blob straight from the DB. */
async function storedPrefs(): Promise<{
  visible?: Record<string, boolean>;
  order?: string[];
}> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { dashboardPrefs: true },
  });
  return (user.dashboardPrefs ?? {}) as {
    visible?: Record<string, boolean>;
    order?: string[];
  };
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "prefs@example.com" });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setDashboardCardVisible", () => {
  test("persists the flip + revalidates the dashboard", async () => {
    const res = await setDashboardCardVisible("activity", false);
    expect(res.activity).toBe(false);
    expect(res.kpis).toBe(true);

    const blob = await storedPrefs();
    expect(blob.visible?.activity).toBe(false);
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  test("preserves a previously saved order (no clobber)", async () => {
    const savedOrder = [...DASHBOARD_CARD_KEYS].reverse();
    await prisma.user.update({
      where: { id: userId },
      data: { dashboardPrefs: { visible: {}, order: savedOrder } },
    });

    await setDashboardCardVisible("kpis", false);

    const blob = await storedPrefs();
    expect(blob.order).toEqual(savedOrder);
    expect(blob.visible?.kpis).toBe(false);
  });

  test("rejects an unknown card key", async () => {
    await expect(
      // Simulate a stale/hostile client bypassing the TS type.
      setDashboardCardVisible("garbage" as never, true)
    ).rejects.toThrow(/Unknown dashboard card key/);
  });
});

describe("setDashboardCardOrder", () => {
  test("persists a valid order + revalidates the dashboard", async () => {
    const desired = [...DASHBOARD_CARD_KEYS].reverse();
    const res = await setDashboardCardOrder(desired);
    expect(res).toEqual(desired);

    const blob = await storedPrefs();
    expect(blob.order).toEqual(desired);
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  test("sanitizes garbage: unknown keys dropped, dupes deduped, missing appended", async () => {
    const res = await setDashboardCardOrder([
      "pulse",
      "garbage",
      "pulse",
      "kpis",
    ]);
    expect(res.slice(0, 2)).toEqual(["pulse", "kpis"]);
    expect(res).not.toContain("garbage");
    // Full permutation, both in the return AND in the DB.
    expect([...res].sort()).toEqual([...DASHBOARD_CARD_KEYS].sort());
    const blob = await storedPrefs();
    expect(blob.order).toEqual(res);
  });

  test("preserves previously saved visibility (no clobber)", async () => {
    await setDashboardCardVisible("deadlines", false);
    await setDashboardCardOrder([...DASHBOARD_CARD_KEYS].reverse());

    const blob = await storedPrefs();
    expect(blob.visible?.deadlines).toBe(false);
  });

  test("works for a user with no prior prefs blob", async () => {
    const res = await setDashboardCardOrder(["agenda", "kpis"]);
    expect(res.slice(0, 2)).toEqual(["agenda", "kpis"]);
    const blob = await storedPrefs();
    expect(blob.order?.slice(0, 2)).toEqual(["agenda", "kpis"]);
    // Visibility half written alongside — defaults, all visible.
    expect(blob.visible?.kpis).toBe(true);
  });
});
