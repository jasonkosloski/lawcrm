/**
 * Integration tests for the dashboard-prefs actions: `saveDashboardLayout`
 * persists a sanitized v3 layout wholesale, and `getDashboardLayout`
 * decodes stored blobs (including legacy v2).
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
  saveDashboardLayout,
} from "@/app/actions/dashboard-prefs";
import { getDashboardLayout } from "@/lib/queries/dashboard-prefs";
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

describe("saveDashboardLayout", () => {
  test("authenticates before validating", async () => {
    mockedGetUser.mockRejectedValue(new Error("unauth"));
    await expect(saveDashboardLayout("junk")).rejects.toThrow("unauth");
  });

  test("rejects non-object input and leaves the stored blob unchanged", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { dashboardPrefs: true },
    });
    for (const bad of [null, "x", 3, []]) {
      await expect(saveDashboardLayout(bad)).rejects.toThrow();
    }
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { dashboardPrefs: true },
    });
    expect(after.dashboardPrefs).toEqual(before.dashboardPrefs);
  });

  test("persists the sanitized layout", async () => {
    const res = await saveDashboardLayout({
      split: "6/6",
      band: ["bogus", "agenda"],
      columns: [["tasks"]],
      hidden: ["pulse"],
    });
    const blob = await storedPrefs();
    expect(blob).toEqual(res);
    expect(res.v).toBe(3);
    expect(res.band).toEqual(["agenda", "kpis"]);
    expect(JSON.stringify(blob)).not.toContain("bogus");
    expect(res.hidden).toEqual(["pulse"]);
  });

  test("revalidates the dashboard", async () => {
    await saveDashboardLayout({});
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  test("getDashboardLayout decodes a stored v2 blob", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { dashboardPrefs: { visible: { pulse: false } } },
    });
    const layout = await getDashboardLayout(userId);
    expect(layout.hidden).toEqual(["pulse"]);
  });
});
