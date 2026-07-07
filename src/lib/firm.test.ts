/**
 * Integration tests for `getFirmGoals`.
 *
 * The goals live on the Firm row (schema defaults 6.0 / 200) and are
 * resolved through the current user → firm join, same path as
 * `getCurrentFirm`. Covers the schema defaults, custom values, and
 * the no-user integrity failure.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// getFirmGoals resolves the viewer via getCurrentUserId; stub the
// auth chain so next-auth doesn't have to load.
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getFirmGoals } from "@/lib/firm";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  ({ userId } = await seedUser({ firmId }));
  mockedGetUser.mockResolvedValue(userId);
});

describe("getFirmGoals", () => {
  test("returns the schema defaults for a fresh firm", async () => {
    const goals = await getFirmGoals();
    expect(goals).toEqual({ dailyHoursGoal: 6.0, monthlyBillableGoal: 200 });
  });

  test("returns the firm's configured values", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: { dailyHoursGoal: 7.5, monthlyBillableGoal: 160 },
    });
    const goals = await getFirmGoals();
    expect(goals).toEqual({ dailyHoursGoal: 7.5, monthlyBillableGoal: 160 });
  });

  test("throws the integrity error when the user row is gone", async () => {
    mockedGetUser.mockResolvedValue("no-such-user");
    await expect(getFirmGoals()).rejects.toThrow(/no firm assigned/i);
  });
});
